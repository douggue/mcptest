/**
 * How to start a program by its name.
 *
 * Away from Windows the name is enough. On Windows a program installed through
 * npm is a `.cmd` file, which cannot be started without a shell, and a prompt
 * must never be handed to a shell as text. So the program is looked for on the
 * path and started in the safest way its kind allows:
 *
 * 1. an `.exe` is started directly;
 * 2. an npm `.cmd` shim is read for the script it runs, and that script is
 *    started with Node directly, with no shell involved;
 * 3. any other `.cmd` or `.bat` goes through `cmd.exe /d /s /c` with every
 *    argument quoted by `quoteForCmd`, and is refused if an argument holds a
 *    line break, which no quoting can carry.
 *
 * Route 3 follows the long-used cross-spawn rules but has not been run on a
 * real Windows computer from here. It has one known weakness: stopping a run
 * stops `cmd.exe`, and the program it started may live on until it finishes.
 */
import { existsSync, readFileSync } from 'node:fs';
import { win32 } from 'node:path';
import { EngineRunError, notInstalled } from './failure';
import type { EngineDeps, FileLookup, Program } from './types';

export interface Launch {
  readonly command: string;
  readonly args: readonly string[];
  /** The arguments are already quoted for cmd.exe and must be passed on untouched. */
  readonly verbatim: boolean;
}

export interface LaunchContext extends Pick<EngineDeps, 'platform' | 'env' | 'files'> {
  /** The Node that runs a shim's script; defaults to the one running Jgtube. */
  readonly nodePath?: string;
}

/** Tried in this order in each folder, as Windows itself does. */
const WINDOWS_EXTENSIONS = ['.exe', '.cmd', '.bat'] as const;
/** The script or program an npm shim hands its arguments to, relative to the shim's folder. */
const SHIM_TARGET = /"%(?:~dp0|dp0%)\\([^"%\r\n]+\.(?:c?js|mjs|exe))"\s+%\*/i;
/** The characters cmd.exe acts on; each is given a caret so it is read as itself. */
const CMD_META = /([()\][%!^"`<>&|;, *?])/g;
/** No quoting carries these through cmd.exe: a line break ends the command. */
const UNQUOTABLE = /[\r\n\0]/;

const realFiles: FileLookup = {
  exists: (path) => existsSync(path),
  read: (path) => readFileSync(path, 'utf8'),
};

/**
 * One argument, quoted for a `.cmd` file started through cmd.exe. Inside the
 * quotes a quote becomes `\"` and the backslashes before it are doubled, as
 * the program on the far end expects. Then every character cmd.exe acts on is
 * escaped twice: once for cmd.exe reading the line, once for the `.cmd` file
 * handing its arguments on.
 */
export function quoteForCmd(argument: string): string {
  const inner = argument.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, '$1$1');
  return `"${inner}"`.replace(CMD_META, '^$1').replace(CMD_META, '^$1');
}

/** The folders of the Windows path, in order. The variable is `Path` or `PATH` there. */
function pathFolders(env: Readonly<Record<string, string | undefined>>): readonly string[] {
  const name = Object.keys(env).find((key) => key.toLowerCase() === 'path');
  return (name ? (env[name] ?? '') : '')
    .split(';')
    .map((folder) => folder.trim().replace(/^"(.*)"$/, '$1'))
    .filter((folder) => folder !== '');
}

/** The first file on the path that Windows would start for this command, or null. */
function findOnPath(command: string, context: LaunchContext, files: FileLookup): string | null {
  for (const folder of pathFolders(context.env)) {
    for (const extension of WINDOWS_EXTENSIONS) {
      const candidate = win32.join(folder, command + extension);
      if (files.exists(candidate)) return candidate;
    }
  }
  return null;
}

/** The script or program a shim runs, when the shim says so and it is there. */
function shimTarget(shim: string, files: FileLookup): string | null {
  let text: string;
  try {
    text = files.read(shim);
  } catch {
    return null;
  }
  const relative = SHIM_TARGET.exec(text)?.[1];
  if (relative === undefined) return null;
  const target = win32.join(win32.dirname(shim), relative);
  return files.exists(target) ? target : null;
}

function throughCmd(shim: string, args: readonly string[], context: LaunchContext): Launch {
  if (args.some((argument) => UNQUOTABLE.test(argument))) {
    throw new EngineRunError(
      'failed',
      'This program is installed in a way that cannot take a line break in its instructions on Windows. Install it with its own installer instead of npm, then try again.',
    );
  }
  const line = [shim.replace(CMD_META, '^$1'), ...args.map(quoteForCmd)].join(' ');
  const comSpec = Object.entries(context.env).find(([key]) => key.toLowerCase() === 'comspec');
  return {
    command: comSpec?.[1] ?? 'cmd.exe',
    args: ['/d', '/s', '/c', `"${line}"`],
    verbatim: true,
  };
}

function windowsLaunch(program: Program, args: readonly string[], context: LaunchContext): Launch {
  const files = context.files ?? realFiles;
  const found = findOnPath(program.command, context, files);
  if (found === null) throw notInstalled(program);
  if (found.toLowerCase().endsWith('.exe')) return { command: found, args, verbatim: false };
  const target = shimTarget(found, files);
  if (target === null) return throughCmd(found, args, context);
  return target.toLowerCase().endsWith('.exe')
    ? { command: target, args, verbatim: false }
    : { command: context.nodePath ?? process.execPath, args: [target, ...args], verbatim: false };
}

/**
 * The command and arguments that start a program. Throws an EngineRunError
 * when, on Windows, the program is not on the path or cannot be started safely.
 */
export function planLaunch(
  program: Program,
  args: readonly string[],
  context: LaunchContext,
): Launch {
  return (context.platform ?? process.platform) === 'win32'
    ? windowsLaunch(program, args, context)
    : { command: program.command, args, verbatim: false };
}
