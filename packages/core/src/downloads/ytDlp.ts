import { readdir, rm, stat } from 'node:fs/promises';
import { VIDEO_ID_PATTERN } from '../sources/parse';
import { pathInside } from './folder';
import { programRunner, type ProgramResult, type RunProgram } from './program';
import {
  VIDEO_MIN_HEIGHT,
  VIDEO_TARGET_HEIGHT,
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
 * only into the temporary folder. The id reaches it in two places only: as
 * the value of `--output`, and inside a full link after `--`, so an id that
 * begins with a dash is never read as an option.
 */

export { findProgram, programSetting, type ProgramResult, type RunProgram } from './program';

/** The program's name; on Windows its file is this with ".exe". */
export const YT_DLP_PROGRAM = 'yt-dlp';
/** A download that takes longer than this has stalled. */
const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_REASON_LENGTH = 200;
/**
 * The smallest single file that has picture and sound and is at least 240
 * lines high. YouTube still offers one such file for most videos (360p MP4);
 * the sharper ones come as picture and sound apart and need a second program
 * to join them, which is not assumed here.
 */
/** The picture heights a file may have: up to the height asked for, never below watchable. */
const HEIGHTS = `[height<=${VIDEO_TARGET_HEIGHT}][height>=${VIDEO_MIN_HEIGHT}]`;
/** One file that already holds picture and sound; YouTube rarely offers one above 360 lines. */
const FORMAT = `best${HEIGHTS}[vcodec!=none][acodec!=none]`;
/**
 * For many videos YouTube no longer offers one file with picture and sound,
 * only the two apart, and the sharper pictures only that way. With ffmpeg on
 * the computer yt-dlp can fetch the best picture up to the height asked for
 * and the best sound and join them into one MP4: the kinds every player reads
 * first (H.264 with AAC), then any.
 */
const JOINED_FORMATS = [
  `bestvideo${HEIGHTS}[vcodec^=avc1]+bestaudio[acodec^=mp4a]`,
  `bestvideo${HEIGHTS}+bestaudio`,
];
const JOINED_AS = 'mp4';
/** Printed once the file is in place: its length, height, container and format id. */
const REPORT = 'after_move:%(duration)s|%(height)s|%(ext)s|%(format_id)s';
/** What yt-dlp says about a video YouTube will not give to anyone signed out. */
const NOT_AVAILABLE =
  /video unavailable|private video|not available|has been removed|sign in to confirm your age|members-only|account .* terminated/i;
const NO_FORMAT = /requested format is not available/i;
/**
 * What yt-dlp says when YouTube turns this computer away, whatever the video:
 * it asks for a sign-in "to confirm you're not a bot", or its servers answer
 * 403 or 429. Seen live in November 2026.
 */
const REFUSED = /not a bot|HTTP Error 4(?:03|29)|too many requests/i;
const REFUSED_MESSAGE =
  'YouTube refused this computer’s connection for now, as it sometimes does when it suspects a program rather than a person. Try again in a few hours, or from another internet connection.';
const STOPPED_MESSAGE = 'The download was stopped because Jgtube is closing.';
/**
 * The option that tells yt-dlp which JavaScript runtime to use. Since late
 * 2026 it warns that reading YouTube without one is deprecated and may miss
 * formats, and the only runtime it looks for by itself is deno. Jgtube runs
 * on Node, so that Node is named.
 */
const JS_RUNTIMES = '--js-runtimes';
/** How a yt-dlp from before that option refuses it. */
const UNKNOWN_JS_RUNTIMES = /no such option: --js-runtimes/i;

const runDirectly: RunProgram = programRunner(DOWNLOAD_TIMEOUT_MS);

/**
 * The arguments yt-dlp is started with. Everything it writes goes into
 * `folder`. `nodePath` is where Node is on this computer; with it, yt-dlp is
 * told to use that Node as its JavaScript runtime. The runtime and its path
 * are one argument (`node:C:\Program Files\nodejs\node.exe` on Windows):
 * nothing here passes through a shell, so spaces and the drive's colon are safe.
 */
export function ytDlpArguments(
  videoId: string,
  folder: string,
  maxBytes: number,
  nodePath: string | null = null,
  ffmpegPath: string | null = null,
): string[] {
  // Joined first when it can be: that is where the height asked for is found.
  const format = ffmpegPath === null ? FORMAT : [...JOINED_FORMATS, FORMAT].join('/');
  return [
    ...(nodePath === null ? [] : [JS_RUNTIMES, `node:${nodePath}`]),
    ...(ffmpegPath === null
      ? []
      : ['--ffmpeg-location', ffmpegPath, '--merge-output-format', JOINED_AS]),
    '--no-playlist',
    '--no-progress',
    '--no-warnings',
    '--no-part',
    '--no-simulate',
    '--format',
    format,
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

const NO_SINGLE_FILE =
  'YouTube offers no file with picture and sound that yt-dlp could fetch for it.';
const NEEDS_FFMPEG =
  'Most videos now come as picture and sound apart, and joining them needs ffmpeg, which Jgtube did not find on this computer.';

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
    if (REFUSED.test(reason)) return failure('refused', REFUSED_MESSAGE);
    if (NO_FORMAT.test(reason)) {
      return failure('not-available', NO_SINGLE_FILE);
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

export interface YtDlpOptions {
  /**
   * Where Node is, for yt-dlp to use as its JavaScript runtime; null to name
   * none. Left out, it is the Node that is running Jgtube.
   */
  readonly nodePath?: string | null;
  /** Aborted when Jgtube is closing: yt-dlp is stopped and its file removed. */
  readonly signal?: AbortSignal;
  /**
   * Where ffmpeg is, when it is on this computer: yt-dlp can then join a
   * picture and a sound that YouTube only offers apart. Without it only a
   * single file with both can be fetched.
   */
  readonly ffmpegPath?: string | null;
}

/**
 * The yt-dlp route, for a program already found on the PATH. A file it leaves
 * behind after any failure is removed. A yt-dlp too old to know the runtime
 * option is started once more without it.
 */
export function ytDlpFetcher(
  program: string,
  run: RunProgram = runDirectly,
  options: YtDlpOptions = {},
): VideoFetcher {
  const nodePath = options.nodePath === undefined ? process.execPath : options.nodePath;
  const { signal } = options;
  const ffmpegPath = options.ffmpegPath ?? null;
  const start = (videoId: string, folder: string, maxBytes: number, node: string | null) =>
    run(program, ytDlpArguments(videoId, folder, maxBytes, node, ffmpegPath), signal);
  return {
    route: 'yt-dlp',
    async fetch(videoId, folder, maxBytes) {
      if (!VIDEO_ID_PATTERN.test(videoId)) {
        throw new Error(`Not a valid YouTube video id: "${videoId.slice(0, 40)}"`);
      }
      await removeFilesOf(folder, videoId);
      const first = await start(videoId, folder, maxBytes, nodePath);
      const tooOld =
        nodePath !== null && first.code !== 0 && UNKNOWN_JS_RUNTIMES.test(first.stderr);
      const result = tooOld ? await start(videoId, folder, maxBytes, null) : first;
      const read = signal?.aborted
        ? failure('unreadable', STOPPED_MESSAGE)
        : await readOutcome(result, videoId, folder, maxBytes);
      const outcome =
        !read.ok && read.message === NO_SINGLE_FILE && ffmpegPath === null
          ? failure('not-available', `${NO_SINGLE_FILE} ${NEEDS_FFMPEG}`)
          : read;
      if (!outcome.ok) await removeFilesOf(folder, videoId);
      return outcome;
    },
  };
}
