import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import { VIDEO_ID_PATTERN } from '../sources/parse';
import { pathInside } from './folder';

/**
 * Fetches one video as a single file with picture and sound, for a tool that
 * watches a video from a file on this computer. The copy is temporary: the
 * caller deletes it after use, and anything left over from an earlier run is
 * removed the next time a video is fetched.
 *
 * Downloading a video is outside YouTube's terms of service, like the rest of
 * how Jgtube reads YouTube. The copy is the smallest one that is still
 * watchable, kept on the owner's own computer and not for long.
 */

/** The folder under the downloads folder that holds the temporary copies. */
export const VIDEO_TEMP_FOLDER = 'video-temp';
/**
 * The largest file handed over. The tool that watches the video refuses media
 * over 100 MB; this sits a little under, so a file that passes here passes there.
 */
export const MAX_VIDEO_BYTES = 95_000_000;
/** A copy left behind for longer than this was forgotten by a run that ended badly. */
export const VIDEO_TEMP_MAX_AGE_HOURS = 24;
/**
 * The least picture height that is still watchable: on-screen text and
 * diagrams can be read at 240 lines, and below it they cannot.
 */
export const VIDEO_MIN_HEIGHT = 240;

const HOUR_MS = 60 * 60 * 1000;

/** How the file was fetched: the yt-dlp program, or the YouTube library Jgtube already uses. */
export type VideoRoute = 'yt-dlp' | 'built-in';

/**
 * 'not-available': YouTube will not give this video (removed, private, age-gated).
 * 'too-large': the smallest watchable copy is over the size limit.
 * 'refused': YouTube turned this computer's connection away for now, whatever the video.
 * 'unreadable': the video exists but the file could not be fetched or is not whole.
 */
export type VideoFailureKind = 'not-available' | 'too-large' | 'refused' | 'unreadable';

/** The failures that are about this computer or this route, so another route is worth trying. */
const WORTH_ANOTHER_ROUTE: readonly VideoFailureKind[] = ['refused', 'unreadable'];

export interface VideoFile {
  readonly ok: true;
  /** The file, as an absolute path inside the temporary folder. */
  readonly path: string;
  readonly bytes: number;
  /** The video's length; null when the route did not say. */
  readonly durationSeconds: number | null;
  /** What was fetched, in words, such as "360p mp4". */
  readonly format: string;
  readonly via: VideoRoute;
}

export interface VideoFailure {
  readonly ok: false;
  readonly kind: VideoFailureKind;
  /** One plain sentence saying what happened. */
  readonly message: string;
  /** The route that gave this answer; null when no route could be tried. */
  readonly via: VideoRoute | null;
  /** Each way that was tried and failed, in order, when more than the answer's own was. */
  readonly attempts?: readonly VideoAttempt[];
  /**
   * For 'too-large': about how many seconds of the video would fit under the
   * limit, when that can be told. The file is never cut to fit: a cut file
   * may not play, so a whole video is handed over or none.
   */
  readonly fitsSeconds?: number | null;
}

/** One way that was tried and failed, with what it said. */
export interface VideoAttempt {
  readonly route: VideoRoute;
  readonly message: string;
}

export type VideoDownload = VideoFile | VideoFailure;

/** One way of fetching a video file. Both ways sit behind this, and tests use a fake. */
export interface VideoFetcher {
  readonly route: VideoRoute;
  /**
   * Writes the video into `folder`, which exists, as one file named after the
   * video id, and never writes anywhere else. Must not leave a file behind
   * when it fails.
   */
  fetch(videoId: string, folder: string, maxBytes: number): Promise<VideoDownload>;
}

export interface VideoDownloadDeps {
  /**
   * The ways to fetch a file, the preferred one first. A way that cannot read
   * the video, or that YouTube refused, hands over to the next; "not
   * available" and "too large" are answers about the video itself and end
   * the attempt.
   */
  readonly fetchers: readonly VideoFetcher[];
  readonly now: () => Date;
}

/** The temporary folder for video copies, inside the downloads folder. */
export const videoTempFolder = (root: string): string => pathInside(root, VIDEO_TEMP_FOLDER);

/**
 * Removes copies left in the temporary folder for more than a day. A file that
 * cannot be removed (in use, no permission) is left for the next time.
 */
export async function cleanVideoTemp(root: string, now: Date): Promise<number> {
  const folder = videoTempFolder(root);
  const names = await readdir(folder).catch(() => [] as string[]);
  let removed = 0;
  for (const name of names) {
    const path = pathInside(folder, name);
    try {
      const age = now.getTime() - (await stat(path)).mtimeMs;
      if (age <= VIDEO_TEMP_MAX_AGE_HOURS * HOUR_MS) continue;
      await rm(path, { recursive: true, force: true });
      removed += 1;
    } catch {
      // Gone already, or held open by another program: nothing to do now.
    }
  }
  return removed;
}

/**
 * Deletes a copy after use. Only a file inside the temporary folder is ever
 * removed, whatever path is passed in.
 */
export async function removeVideoFile(root: string, path: string): Promise<void> {
  const folder = videoTempFolder(root);
  await rm(pathInside(folder, path), { force: true });
}

const NO_ROUTE: VideoFailure = {
  ok: false,
  kind: 'unreadable',
  message: 'Jgtube has no way to fetch a video file on this computer.',
  via: null,
};

/**
 * Downloads one video as a single file with picture and sound into the
 * temporary folder under `root`, and returns where it is, how big, how long
 * and in what format, or a typed failure. Old copies are cleared first. When
 * every way failed, a refusal by YouTube is the answer given over any later
 * failure: it says what to do, which "could not be fetched" does not.
 */
export async function downloadVideoFile(
  deps: VideoDownloadDeps,
  videoId: string,
  root: string,
): Promise<VideoDownload> {
  if (!VIDEO_ID_PATTERN.test(videoId)) {
    throw new Error(`Not a valid YouTube video id: "${videoId.slice(0, 40)}"`);
  }
  const folder = videoTempFolder(root);
  await mkdir(folder, { recursive: true });
  await cleanVideoTemp(root, deps.now());
  let last: VideoFailure = NO_ROUTE;
  let attempts: readonly VideoAttempt[] = [];
  for (const fetcher of deps.fetchers) {
    const result = await fetcher.fetch(videoId, folder, MAX_VIDEO_BYTES);
    if (result.ok || !WORTH_ANOTHER_ROUTE.includes(result.kind)) return result;
    attempts = [...attempts, { route: fetcher.route, message: result.message }];
    last = last.kind === 'refused' ? last : result;
  }
  return { ...last, attempts };
}
