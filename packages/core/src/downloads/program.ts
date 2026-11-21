import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { delimiter, isAbsolute, join } from 'node:path';

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

/**
 * Where a program is on the PATH, as an absolute path, or null when it is not
 * installed. Nothing is run to find out.
 */
export async function findProgram(
  name: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
  platform: NodeJS.Platform = process.platform,
): Promise<string | null> {
  for (const folder of pathFolders(env)) {
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
