import { parseVideoRef } from '../video/ref';
import { builtInVideoFetcher, type VideoPlayerSource } from './builtInVideo';
import { downloadVideoFile, type VideoDownload, type VideoFetcher } from './videoFile';
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
  const fetchers: readonly VideoFetcher[] = [
    ...(program === null ? [] : [ytDlpFetcher(program, options.run)]),
    ...(options.source ? [builtInVideoFetcher(options.source)] : []),
  ];
  return downloadVideoFile(
    { fetchers, now: options.now ?? (() => new Date()) },
    videoId,
    options.root,
  );
}
