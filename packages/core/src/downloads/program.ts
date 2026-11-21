import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { access, readdir, stat } from 'node:fs/promises';
import { basename, delimiter, isAbsolute, join, win32 } from 'node:path';
import { z } from 'zod';

/**
 * Finding and starting the helper programs the owner may have installed
 * (yt-dlp, ffmpeg). A program is found by looking in the PATH's absolute
 * folders, never by running anything, and is started directly with its
 * arguments as a list, never through a shell.
 */

/** The most a program may print before it is stopped: none of them has more to say. */
const MAX_OUTPUT_BYTES = 1_000_000;

/** The file names a program may have on this kind of computer. */
function programNames(name: string, platform: NodeJS.Platform): readonly string[] {
  return platform === 'win32' ? [`${name}.exe`] : [name];
}

/** The PATH as the environment gives it, under whichever capitalisation it uses. */
function pathFolders(env: Readonly<Record<string, string | undefined>>): readonly string[] {
  const key = Object.keys(env).find((name) => name.toUpperCase() === 'PATH');
  const value = key === undefined ? '' : (env[key] ?? '');
  // A folder that is not absolute means "wherever the command is run", which
  // could be a folder someone else can write to; those are never searched.
  return value.split(delimiter).filter((folder) => isAbsolute(folder));
}

async function isProgram(path: string, platform: NodeJS.Platform): Promise<boolean> {
  try {
    if (!(await stat(path)).isFile()) return false;
    if (platform !== 'win32') await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** A setting's value whatever capitalisation its name has: Windows ignores it. */
function envValue(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
): string | undefined {
  const key = Object.keys(env).find((candidate) => candidate.toUpperCase() === name.toUpperCase());
  return key === undefined ? undefined : env[key]?.trim() || undefined;
}

/**
 * The setting that names a program's full path, for a program that is not on
 * the PATH: `JGTUBE_YT_DLP_PATH` for yt-dlp, `JGTUBE_FFMPEG_PATH` for ffmpeg.
 */
export const programSetting = (name: string): string =>
  `JGTUBE_${name.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_PATH`;

/**
 * What such a setting must be: the full path of the program file, as this
 * kind of computer or Windows writes one. Whether a program is there is found
 * out when it is looked for.
 */
export const PROGRAM_PATH_RULE = z
  .string()
  .min(1)
  .max(1000)
  .refine((path) => isAbsolute(path) || win32.isAbsolute(path), {
    message: 'must be the full path of the program file',
  });

/** The folders inside `parent`, as full paths; none when it cannot be read. */
async function foldersIn(parent: string): Promise<readonly string[]> {
  const entries = await readdir(parent, { withFileTypes: true }).catch(() => []);
  return entries.filter((entry) => entry.isDirectory()).map((entry) => join(parent, entry.name));
}

/** How the folders of Python installed from the Microsoft Store are named. */
const STORE_PYTHON = 'PythonSoftwareFoundation.Python.';

/**
 * Where the usual Windows installers put a program without always adding it
 * to the PATH of a terminal that was already open: winget's links, scoop's
 * shims, Chocolatey, and the Scripts folders of Python, including Python
 * from the Microsoft Store (where `pip install` puts yt-dlp). Only folders named by the owner's own environment are used.
 */
async function windowsInstallFolders(
  env: Readonly<Record<string, string | undefined>>,
): Promise<readonly string[]> {
  const under = (base: string, ...parts: readonly string[]): readonly string[] => {
    const root = envValue(env, base);
    return root !== undefined && isAbsolute(root) ? [join(root, ...parts)] : [];
  };
  const pythons = [...under('LOCALAPPDATA', 'Programs', 'Python'), ...under('APPDATA', 'Python')];
  // Python from the Microsoft Store keeps what `pip install` adds in its own package folder.
  const storePythons = (await Promise.all(under('LOCALAPPDATA', 'Packages').map(foldersIn)))
    .flat()
    .filter((folder) => basename(folder).startsWith(STORE_PYTHON))
    .map((folder) => join(folder, 'LocalCache', 'local-packages'));
  const scripts = (await Promise.all([...pythons, ...storePythons].map(foldersIn)))
    .flat()
    .map((folder) => join(folder, 'Scripts'));
  return [
    ...under('LOCALAPPDATA', 'Microsoft', 'WinGet', 'Links'),
    ...under('USERPROFILE', 'scoop', 'shims'),
    ...under('ALLUSERSPROFILE', 'chocolatey', 'bin'),
    ...scripts,
  ];
}

/**
 * Where a program is, as an absolute path, or null when it cannot be found:
 * the path the owner named in its setting, else a folder on the PATH, else,
 * on Windows, a folder the usual installers use. Nothing is run to find out.
 */
export async function findProgram(
  name: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
  platform: NodeJS.Platform = process.platform,
): Promise<string | null> {
  const named = envValue(env, programSetting(name));
  if (named !== undefined && isAbsolute(named) && (await isProgram(named, platform))) return named;
  const folders = [
    ...pathFolders(env),
    ...(platform === 'win32' ? await windowsInstallFolders(env) : []),
  ];
  for (const folder of folders) {
    for (const file of programNames(name, platform)) {
      const candidate = join(folder, file);
      if (await isProgram(candidate, platform)) return candidate;
    }
  }
  return null;
}

export interface ProgramResult {
  /** The exit code; null when the program was stopped (it ran out of time, or Jgtube is closing). */
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Starts a program with a list of arguments and waits for it. Aborting
 * `signal` stops the program. Tests replace this.
 */
export type RunProgram = (
  program: string,
  args: readonly string[],
  signal?: AbortSignal,
) => Promise<ProgramResult>;

/** A runner that stops a program which takes longer than `timeoutMs` or prints without end. */
export function programRunner(timeoutMs: number): RunProgram {
  return (program, args, signal) =>
    new Promise((resolve) => {
      execFile(
        program,
        [...args],
        {
          timeout: timeoutMs,
          maxBuffer: MAX_OUTPUT_BYTES,
          windowsHide: true,
          ...(signal ? { signal } : {}),
        },
        (error, stdout, stderr) => {
          const code = error === null ? 0 : typeof error.code === 'number' ? error.code : null;
          resolve({ code, stdout, stderr });
        },
      );
    });
}
