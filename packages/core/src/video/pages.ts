import type { StoredVideoDetails, TranscriptRepo, VideoDetailsRepo } from '../repos/types';
import type { ApiVideoDetails } from '../sources/dataApi';
import { VIDEO_ID_PATTERN } from '../sources/parse';
import type { StoryboardLevel, VideoPage, VideoTranscript, YouTubeSource } from '../sources/types';

/**
 * Reads what a video's own page holds (captions, description and tags,
 * storyboard), from the store when it is there and from YouTube when it is
 * not. One read of a page stores everything it gave, so asking for a video's
 * transcript also saves its description and its storyboard for later.
 */

const HOUR_MS = 60 * 60 * 1000;
/**
 * How long "this video has no captions" is believed. YouTube writes automatic
 * captions some hours after an upload, so a day later the answer may differ;
 * captions that were found are kept for good.
 */
export const TRANSCRIPT_NONE_RETRY_HOURS = 24;
/**
 * How long stored sheet addresses are used. They are signed, and how long a
 * signature lasts is not documented; looking through one video takes minutes,
 * so six hours is ample, and a later look reads the page again (one request).
 */
export const STORYBOARD_FRESH_HOURS = 6;
const MAX_REASON_LENGTH = 200;

export interface VideoPageDeps {
  readonly source: Pick<YouTubeSource, 'fetchVideoPage'>;
  readonly transcripts: TranscriptRepo;
  readonly details: VideoDetailsRepo;
  readonly now: () => Date;
  /**
   * The official API's details call. Present only when the owner's key is
   * set; it reads fifty videos in one request where a watch page reads one.
   */
  readonly fetchDetails?: (videoIds: readonly string[]) => Promise<readonly ApiVideoDetails[]>;
}

function requireVideoId(videoId: string): void {
  if (!VIDEO_ID_PATTERN.test(videoId)) {
    throw new Error(`Not a valid YouTube video id: "${videoId.slice(0, 40)}"`);
  }
}

const reasonOf = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error))
    .split(/\r?\n/, 1)[0]
    ?.slice(0, MAX_REASON_LENGTH) ?? '';

/** Reads one video's page from YouTube and stores everything it gave. */
async function readPage(
  deps: VideoPageDeps,
  videoId: string,
  transcript: boolean,
): Promise<VideoPage> {
  const page = await deps.source.fetchVideoPage(videoId, { transcript });
  const readAt = deps.now();
  if (page.details) deps.details.saveDetails(videoId, page.details, 'web', readAt);
  deps.details.saveStoryboard(videoId, page.storyboard, readAt);
  if (page.transcript !== undefined) deps.transcripts.save(videoId, page.transcript, readAt);
  return page;
}

export interface TranscriptResult {
  readonly videoId: string;
  /** Null when the video has no captions: a normal answer, not a failure. */
  readonly transcript: VideoTranscript | null;
  readonly fetchedAt: Date;
  /** True when nothing was asked of YouTube. */
  readonly fromStore: boolean;
}

/** A video's captions: stored ones as they are, otherwise read once and stored. */
export async function readTranscript(
  deps: VideoPageDeps,
  videoId: string,
): Promise<TranscriptResult> {
  requireVideoId(videoId);
  const stored = deps.transcripts.find(videoId);
  const now = deps.now();
  const stillBelieved =
    stored !== null &&
    (stored.transcript !== null ||
      now.getTime() - stored.fetchedAt.getTime() < TRANSCRIPT_NONE_RETRY_HOURS * HOUR_MS);
  if (stored !== null && stillBelieved) return { ...stored, fromStore: true };
  const page = await readPage(deps, videoId, true);
  return { videoId, transcript: page.transcript ?? null, fetchedAt: now, fromStore: false };
}

export interface StoryboardResult {
  /** Empty when the video has no storyboard. */
  readonly levels: readonly StoryboardLevel[];
  readonly fromStore: boolean;
}

/** A video's storyboard: the stored one while its addresses are fresh, otherwise read again. */
export async function readStoryboard(
  deps: VideoPageDeps,
  videoId: string,
  options: { readonly refresh?: boolean } = {},
): Promise<StoryboardResult> {
  requireVideoId(videoId);
  const stored = deps.details.findStoryboard(videoId);
  const fresh =
    stored !== null &&
    deps.now().getTime() - stored.fetchedAt.getTime() < STORYBOARD_FRESH_HOURS * HOUR_MS;
  if (stored !== null && fresh && !options.refresh) {
    return { levels: stored.levels, fromStore: true };
  }
  return { levels: (await readPage(deps, videoId, false)).storyboard, fromStore: false };
}

export interface DetailsProblem {
  readonly videoId: string;
  readonly reason: string;
}

export interface DetailsResult {
  /** In the order asked for; a video that could not be read is absent. */
  readonly details: readonly StoredVideoDetails[];
  readonly problems: readonly DetailsProblem[];
  /**
   * Why the official API could not be used, when it was asked and refused
   * (allowance used up, no connection). The videos were then read one by one.
   */
  readonly apiProblem: string | null;
}

/**
 * Asks the official API about the videos, when there is a key, and stores
 * what it knows. Returns why it could not, or null when it could or was not
 * asked: the watch pages hold the same text, so a refusal is not a failure.
 */
async function fillFromApi(
  deps: VideoPageDeps,
  videoIds: readonly string[],
): Promise<string | null> {
  if (!deps.fetchDetails || videoIds.length === 0) return null;
  try {
    const found = await deps.fetchDetails(videoIds);
    const readAt = deps.now();
    for (const entry of found) {
      const { videoId, ...details } = entry;
      deps.details.saveDetails(videoId, { ...details, durationSeconds: null }, 'api', readAt);
    }
    return null;
  } catch (error) {
    return reasonOf(error);
  }
}

/**
 * The description and tags of the given videos. Stored ones are returned as
 * they are. The rest are asked of the official API in one request when the
 * owner's key is set; whatever it does not give is read from the video's own
 * page, one video at a time. One video failing does not fail the others.
 */
export async function readVideoDetails(
  deps: VideoPageDeps,
  videoIds: readonly string[],
): Promise<DetailsResult> {
  videoIds.forEach(requireVideoId);
  const wanted = [...new Set(videoIds)];
  const missing = (): readonly string[] =>
    wanted.filter((id) => deps.details.findDetails(id) === null);
  const apiProblem = await fillFromApi(deps, missing());
  let problems: readonly DetailsProblem[] = [];
  for (const videoId of missing()) {
    try {
      const page = await readPage(deps, videoId, false);
      if (page.details === null) {
        problems = [...problems, { videoId, reason: 'YouTube gave no description for it' }];
      }
    } catch (error) {
      problems = [...problems, { videoId, reason: reasonOf(error) }];
    }
  }
  return {
    details: wanted.flatMap((id) => deps.details.findDetails(id) ?? []),
    problems,
    apiProblem,
  };
}
