import { parseVideoRef } from '../video/ref';
import { builtInVideoFetcher, type VideoPlayerSource } from './builtInVideo';
import { programSetting } from './program';
import {
  downloadVideoFile,
  type VideoDownload,
  type VideoFailure,
  type VideoFetcher,
} from './videoFile';
import { YT_DLP_PROGRAM, findProgram, ytDlpFetcher, type RunProgram } from './ytDlp';

export interface DownloadVideoOptions {
  /** The downloads folder (`downloadsRoot`); the file goes into its temporary area. */
  readonly root: string;
  /**
   * Gives the built-in route the player's answer for a video: an
   * `InnertubeSource`. Without it only yt-dlp can be used.
   */
  readonly source?: VideoPlayerSource;
  readonly now?: () => Date;
  /** Where to look for yt-dlp; tests replace these. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly platform?: NodeJS.Platform;
  /** Replaces starting yt-dlp; used by tests. */
  readonly run?: RunProgram;
  /** Aborted when Jgtube is closing: a yt-dlp that is running is stopped. */
  readonly signal?: AbortSignal;
}

/**
 * Downloads one video, given as an id or a link, as a single small file with
 * picture and sound, and says which route fetched it. yt-dlp is used when it
 * is installed on this computer; otherwise, or when yt-dlp cannot read the
 * video, the YouTube library Jgtube already has is used. The caller deletes
 * the file after use with `removeVideoFile`.
 */
export async function downloadVideo(
  video: string,
  options: DownloadVideoOptions,
): Promise<VideoDownload> {
  const videoId = parseVideoRef(video);
  const program = await findProgram(YT_DLP_PROGRAM, options.env, options.platform);
  const ffmpegPath = await findProgram(FFMPEG, options.env, options.platform);
  const fetchers: readonly VideoFetcher[] = [
    ...(program === null
      ? []
      : [
          ytDlpFetcher(program, options.run, {
            ffmpegPath,
            ...(options.signal ? { signal: options.signal } : {}),
          }),
        ]),
    ...(options.source ? [builtInVideoFetcher(options.source)] : []),
  ];
  const result = await downloadVideoFile(
    { fetchers, now: options.now ?? (() => new Date()) },
    videoId,
    options.root,
  );
  return result.ok ? result : { ...result, message: whatHappened(result, program) };
}

/** The program yt-dlp needs to join a picture and a sound that YouTube offers apart. */
const FFMPEG = 'ffmpeg';

const GIVE_THE_FILE = 'You can also give Jgtube the video file yourself.';

/**
 * A failed download in words the owner can act on: whether yt-dlp was found,
 * what each way that was tried said, and what to do next. A failure that is
 * about the video itself (removed, too large) is left as it is.
 */
function whatHappened(failure: VideoFailure, ytDlp: string | null): string {
  const attempts = failure.attempts ?? [];
  if (attempts.length === 0) return failure.message;
  const builtIn = attempts.find((attempt) => attempt.route === 'built-in');
  const viaYtDlp = attempts.find((attempt) => attempt.route === 'yt-dlp');
  if (ytDlp === null) {
    return [
      'Jgtube did not find yt-dlp on this computer, so it used its own download.',
      builtIn?.message ?? failure.message,
      `If yt-dlp is installed, type "npm run engines" to see where Jgtube looks, or put the full path of the yt-dlp program after ${programSetting(YT_DLP_PROGRAM)}= in the .env file and start Jgtube again.`,
      GIVE_THE_FILE,
    ].join(' ');
  }
  return [
    `yt-dlp (${ytDlp}) was tried first. ${viaYtDlp?.message ?? ''}`.trim(),
    ...(builtIn ? [`Then Jgtube's own download was tried. ${builtIn.message}`] : []),
    GIVE_THE_FILE,
  ].join(' ');
}
