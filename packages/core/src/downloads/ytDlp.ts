import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { access, readdir, rm, stat } from 'node:fs/promises';
import { delimiter, isAbsolute, join } from 'node:path';
import { VIDEO_ID_PATTERN } from '../sources/parse';
import { pathInside } from './folder';
import {
  VIDEO_MIN_HEIGHT,
  type VideoDownload,
  type VideoFailure,
  type VideoFetcher,
} from './videoFile';

/**
 * Fetches a video file with the yt-dlp program, when the owner has it
 * installed. It is the sturdier of the two routes: it is updated whenever
 * YouTube changes, which the library inside Jgtube is not.
 *
 * The program is found on the PATH, started directly (never through a shell)
 * with its arguments as a list, given a validated video id and told to write
 * only into the temporary folder.
 */

/** The program's name; on Windows its file is this with ".exe". */
export const YT_DLP_PROGRAM = 'yt-dlp';
/** A download that takes longer than this has stalled. */
const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_OUTPUT_BYTES = 1_000_000;
const MAX_REASON_LENGTH = 200;
/**
 * The smallest single file that has picture and sound and is at least 240
 * lines high. YouTube still offers one such file for most videos (360p MP4);
 * the sharper ones come as picture and sound apart and need a second program
 * to join them, which is not assumed here.
 */
const FORMAT = `worst[height>=${VIDEO_MIN_HEIGHT}][vcodec!=none][acodec!=none]`;
/** Printed once the file is in place: its length, height, container and format id. */
const REPORT = 'after_move:%(duration)s|%(height)s|%(ext)s|%(format_id)s';
/** What yt-dlp says about a video YouTube will not give to anyone signed out. */
const NOT_AVAILABLE =
  /video unavailable|private video|not available|has been removed|sign in to confirm your age|members-only|account .* terminated/i;
const NO_FORMAT = /requested format is not available/i;

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
  /** The exit code; null when the program was stopped (it ran out of time). */
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** Starts a program with a list of arguments and waits for it. Tests replace this. */
export type RunProgram = (program: string, args: readonly string[]) => Promise<ProgramResult>;

const runDirectly: RunProgram = (program, args) =>
  new Promise((resolve) => {
    execFile(
      program,
      [...args],
      { timeout: DOWNLOAD_TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES, windowsHide: true },
      (error, stdout, stderr) => {
        const code = error === null ? 0 : typeof error.code === 'number' ? error.code : null;
        resolve({ code, stdout, stderr });
      },
    );
  });

/** The arguments yt-dlp is started with. Everything it writes goes into `folder`. */
export function ytDlpArguments(videoId: string, folder: string, maxBytes: number): string[] {
  return [
    '--no-playlist',
    '--no-progress',
    '--no-warnings',
    '--no-part',
    '--no-simulate',
    '--format',
    FORMAT,
    '--max-filesize',
    String(maxBytes),
    '--paths',
    folder,
    '--output',
    `${videoId}.%(ext)s`,
    '--print',
    REPORT,
    '--',
    `https://www.youtube.com/watch?v=${videoId}`,
  ];
}

const failure = (kind: VideoFailure['kind'], message: string): VideoFailure => ({
  ok: false,
  kind,
  message,
  via: 'yt-dlp',
});

function numberOr(text: string | undefined): number | null {
  const value = Number(text);
  return text !== undefined && text !== '' && Number.isFinite(value) ? value : null;
}

/** The first line yt-dlp wrote about what went wrong, without its "ERROR:" prefix. */
function reasonFrom(result: ProgramResult): string {
  const line = result.stderr.split(/\r?\n/).find((text) => text.trim() !== '') ?? '';
  return line.replace(/^ERROR:\s*/, '').slice(0, MAX_REASON_LENGTH);
}

async function removeFilesOf(folder: string, videoId: string): Promise<void> {
  const names = await readdir(folder).catch(() => [] as string[]);
  await Promise.all(
    names
      .filter((name) => name.startsWith(`${videoId}.`))
      .map((name) => rm(pathInside(folder, name), { force: true })),
  );
}

/** What yt-dlp left in the folder for this video, turned into the answer. */
async function readOutcome(
  result: ProgramResult,
  videoId: string,
  folder: string,
  maxBytes: number,
): Promise<VideoDownload> {
  const megabytes = Math.round(maxBytes / 1_000_000);
  if (result.code !== 0) {
    const reason = reasonFrom(result);
    if (result.code === null) return failure('unreadable', 'yt-dlp took too long and was stopped.');
    if (NO_FORMAT.test(reason)) {
      return failure(
        'not-available',
        'YouTube offers no single file with picture and sound for it.',
      );
    }
    return NOT_AVAILABLE.test(reason)
      ? failure('not-available', `YouTube will not give this video: ${reason}`)
      : failure('unreadable', `yt-dlp could not fetch it: ${reason}`);
  }
  const [name] = (await readdir(folder)).filter((file) => file.startsWith(`${videoId}.`));
  if (name === undefined) {
    // yt-dlp skips a file over --max-filesize and still ends without an error.
    return failure('too-large', `The video is larger than the ${megabytes} MB a file may be.`);
  }
  const path = pathInside(folder, name);
  const { size } = await stat(path);
  if (size > maxBytes) {
    return failure('too-large', `The video is larger than the ${megabytes} MB a file may be.`);
  }
  if (size === 0) return failure('unreadable', 'yt-dlp wrote an empty file.');
  const [duration, height, extension] = (result.stdout.trim().split(/\r?\n/).at(-1) ?? '').split(
    '|',
  );
  const lines = numberOr(height);
  return {
    ok: true,
    path,
    bytes: size,
    durationSeconds: numberOr(duration),
    format: `${lines === null ? '' : `${lines}p `}${extension || name.split('.').at(-1) || 'file'}`,
    via: 'yt-dlp',
  };
}

/**
 * The yt-dlp route, for a program already found on the PATH. A file it leaves
 * behind after any failure is removed.
 */
export function ytDlpFetcher(program: string, run: RunProgram = runDirectly): VideoFetcher {
  return {
    route: 'yt-dlp',
    async fetch(videoId, folder, maxBytes) {
      if (!VIDEO_ID_PATTERN.test(videoId)) {
        throw new Error(`Not a valid YouTube video id: "${videoId.slice(0, 40)}"`);
      }
      await removeFilesOf(folder, videoId);
      const result = await run(program, ytDlpArguments(videoId, folder, maxBytes));
      const outcome = await readOutcome(result, videoId, folder, maxBytes);
      if (!outcome.ok) await removeFilesOf(folder, videoId);
      return outcome;
    },
  };
}
