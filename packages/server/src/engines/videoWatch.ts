/**
 * Has an engine watch one YouTube video and answer a question about it.
 *
 * Two engines can watch. Antigravity watches a file on this computer, so it
 * comes first when it is installed and a whole copy of the video can be had
 * from the downloader. Otherwise the Gemini API watches the public video by
 * its link, when the owner has set a key. With neither, the failure says so,
 * and the caller can fall back to frames and a transcript.
 */
import { AGY } from './agy';
import { WATCH_TIMEOUT_MS, checkVideoFile, watchLinkWithAgy, watchWithAgy } from './agyVideo';
import { EngineRunError, notInstalled, type SkippedEngine } from './failure';
import { firstAnswer, type Candidate, type EngineAnswer } from './fallback';
import { watchWithGemini, type GeminiFetch } from './geminiVideo';
import type { EngineSettings } from './settings';
import type { EngineDeps, VideoQuestion } from './types';
import { NOT_A_VIDEO_ID, isVideoId } from './videoId';

/** The engines that can watch a video. */
export type VideoEngineId = 'agy' | 'gemini-api';
export type VideoAnswer = EngineAnswer<VideoEngineId>;

/** A copy of a video on this computer, or why there is none. */
export type VideoDownload =
  | {
      readonly ok: true;
      readonly path: string;
      /**
       * Removes the copy. Given by a downloader that made the copy for this
       * watch alone; left out when the file is to be kept (the owner's own, or
       * one the caller will use again and remove itself). It is called once
       * the watch is over, however it ended.
       */
      readonly remove?: () => Promise<void>;
    }
  | { readonly ok: false; readonly reason: string };

/**
 * Fetches a video to a file on this computer and says where it is. The file
 * stays the downloader's: the engines copy it and never change it, and it is
 * removed only through the `remove` the downloader hands over with it.
 * `videoId` has been checked to be a YouTube video id. Aborting `stop` means
 * Jgtube is closing.
 */
export type DownloadVideo = (videoId: string, stop: AbortSignal) => Promise<VideoDownload>;

/** What a watch is doing now, for whoever is showing progress. */
export type WatchStep =
  { readonly kind: 'downloading' } | { readonly kind: 'watching'; readonly engine: VideoEngineId };

export interface VideoToWatch {
  readonly videoId: string;
  readonly question: string;
  readonly systemPrompt: string;
}

export interface VideoWatchContext {
  readonly settings: EngineSettings;
  readonly deps: EngineDeps;
  /** A private folder for the engine's runs. */
  readonly workDir: string;
  /** Whether Antigravity is on this computer; asked before anything is downloaded. */
  readonly agyInstalled: () => Promise<boolean>;
  /** Absent until a downloader is connected: Antigravity then has no file to watch. */
  readonly download?: DownloadVideo | undefined;
  readonly geminiFetch?: GeminiFetch | undefined;
  /** Told when a download starts and when an engine starts watching. */
  readonly onStep?: ((step: WatchStep) => void) | undefined;
}

/** What a caller may set for one watch. */
export interface WatchOptions {
  /**
   * Gives the copy to watch instead of the usual downloader: for a caller
   * that already has the file, or knows there is none.
   */
  readonly download?: DownloadVideo | undefined;
  readonly onStep?: ((step: WatchStep) => void) | undefined;
}

/** Remembers a copy that must be removed when the watch is over. */
type Keep = (remove: () => Promise<void>) => void;

const NOBODY = 'No engine on this computer can watch a video.';
const NO_DOWNLOADER = 'Jgtube cannot download videos yet';
const NEVER_STOPPED = new AbortController().signal;

const skip = (engine: VideoEngineId, error: EngineRunError): SkippedEngine => ({
  engine,
  reason: error.reason,
  message: error.message,
});

/** A whole copy of the video on this computer, or the reason there is none. */
async function localCopy(
  videoId: string,
  context: VideoWatchContext,
  keep: Keep,
): Promise<VideoDownload> {
  if (!context.download) return { ok: false, reason: NO_DOWNLOADER };
  context.onStep?.({ kind: 'downloading' });
  const copy = await context.download(videoId, context.deps.signal ?? NEVER_STOPPED);
  if (!copy.ok) return copy;
  // Kept for removal before the file is even looked at: an unusable copy goes too.
  if (copy.remove) keep(copy.remove);
  try {
    await checkVideoFile(copy.path);
    return copy;
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : 'the file is unusable' };
  }
}

/** How Antigravity would watch this video, or why it is passed over. */
async function agyAttempt(
  video: VideoToWatch,
  question: VideoQuestion,
  context: VideoWatchContext,
  keep: Keep,
): Promise<Candidate<VideoEngineId>> {
  const { settings, deps } = context;
  if (!(await context.agyInstalled())) return skip('agy', notInstalled(AGY));
  const copy = await localCopy(video.videoId, context, keep);
  const watching = (): void => context.onStep?.({ kind: 'watching', engine: 'agy' });
  if (copy.ok) {
    const request = { ...question, videoPath: copy.path };
    return {
      engine: 'agy',
      run: () => {
        watching();
        return watchWithAgy(request, deps, settings.agyModel);
      },
    };
  }
  if (settings.agyYouTubeLinks) {
    const request = { ...question, videoId: video.videoId };
    return {
      engine: 'agy',
      run: () => {
        watching();
        return watchLinkWithAgy(request, deps, settings.agyModel);
      },
    };
  }
  return {
    engine: 'agy',
    reason: 'failed',
    message: `Antigravity had no copy of the video to watch: ${copy.reason}.`,
  };
}

function geminiAttempt(video: VideoToWatch, context: VideoWatchContext): Candidate<VideoEngineId> {
  const { gemini } = context.settings;
  if (!gemini) {
    return {
      engine: 'gemini-api',
      reason: 'not-installed',
      message: 'No GEMINI_API_KEY is set in the .env file.',
    };
  }
  const { geminiFetch, deps } = context;
  return {
    engine: 'gemini-api',
    run: () => {
      context.onStep?.({ kind: 'watching', engine: 'gemini-api' });
      return watchWithGemini({ ...video, timeoutMs: WATCH_TIMEOUT_MS }, gemini, {
        ...(geminiFetch ? { fetch: geminiFetch } : {}),
        ...(deps.signal ? { signal: deps.signal } : {}),
      });
    },
  };
}

/**
 * Watches one video with the first engine that can. Rejects with an
 * EngineRunError: 'not-installed' when no engine can watch, else the failure
 * of the engine that tried. A copy the downloader made for this watch is
 * removed before this returns or rejects, whichever way the watch went.
 */
export async function watchVideo(
  video: VideoToWatch,
  context: VideoWatchContext,
): Promise<VideoAnswer> {
  if (!isVideoId(video.videoId)) throw new EngineRunError('failed', NOT_A_VIDEO_ID);
  const question: VideoQuestion = {
    question: video.question,
    systemPrompt: video.systemPrompt,
    timeoutMs: WATCH_TIMEOUT_MS,
    cwd: context.workDir,
  };
  let copies: ReadonlyArray<() => Promise<void>> = [];
  const keep: Keep = (remove) => {
    copies = [...copies, remove];
  };
  try {
    return await firstAnswer(
      [
        // An engine the owner's settings leave out is never started, and is not mentioned.
        ...(context.settings.order.includes('agy')
          ? [await agyAttempt(video, question, context, keep)]
          : []),
        geminiAttempt(video, context),
      ],
      NOBODY,
    );
  } finally {
    // A copy that will not go (still held open) is cleared with the day-old ones later.
    await Promise.all(copies.map((remove) => remove().catch(() => undefined)));
  }
}
