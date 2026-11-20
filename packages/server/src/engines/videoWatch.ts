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
  { readonly ok: true; readonly path: string } | { readonly ok: false; readonly reason: string };

/**
 * Fetches a video to a file on this computer and says where it is. The file
 * stays the downloader's: the engines copy it and never change or remove it.
 * `videoId` has been checked to be a YouTube video id. Aborting `stop` means
 * Jgtube is closing.
 */
export type DownloadVideo = (videoId: string, stop: AbortSignal) => Promise<VideoDownload>;

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
}

const NOBODY = 'No engine on this computer can watch a video.';
const NO_DOWNLOADER = 'Jgtube cannot download videos yet';
const NEVER_STOPPED = new AbortController().signal;

const skip = (engine: VideoEngineId, error: EngineRunError): SkippedEngine => ({
  engine,
  reason: error.reason,
  message: error.message,
});

/** A whole copy of the video on this computer, or the reason there is none. */
async function localCopy(videoId: string, context: VideoWatchContext): Promise<VideoDownload> {
  if (!context.download) return { ok: false, reason: NO_DOWNLOADER };
  const copy = await context.download(videoId, context.deps.signal ?? NEVER_STOPPED);
  if (!copy.ok) return copy;
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
): Promise<Candidate<VideoEngineId>> {
  const { settings, deps } = context;
  if (!(await context.agyInstalled())) return skip('agy', notInstalled(AGY));
  const copy = await localCopy(video.videoId, context);
  if (copy.ok) {
    const request = { ...question, videoPath: copy.path };
    return { engine: 'agy', run: () => watchWithAgy(request, deps, settings.agyModel) };
  }
  if (settings.agyYouTubeLinks) {
    const request = { ...question, videoId: video.videoId };
    return { engine: 'agy', run: () => watchLinkWithAgy(request, deps, settings.agyModel) };
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
    run: () =>
      watchWithGemini({ ...video, timeoutMs: WATCH_TIMEOUT_MS }, gemini, {
        ...(geminiFetch ? { fetch: geminiFetch } : {}),
        ...(deps.signal ? { signal: deps.signal } : {}),
      }),
  };
}

/**
 * Watches one video with the first engine that can. Rejects with an
 * EngineRunError: 'not-installed' when no engine can watch, else the failure
 * of the engine that tried.
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
  return firstAnswer(
    [
      // An engine the owner's settings leave out is never started, and is not mentioned.
      ...(context.settings.order.includes('agy')
        ? [await agyAttempt(video, question, context)]
        : []),
      geminiAttempt(video, context),
    ],
    NOBODY,
  );
}
