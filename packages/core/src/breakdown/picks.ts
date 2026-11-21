import { MAX_VIDEO_BYTES } from '../downloads/videoFile';
import { buildVideoReport } from '../report';
import type { StoredVideo } from '../repos/types';
import { VIDEO_ID_PATTERN } from '../sources/parse';
import { clock } from '../video/transcriptText';

/**
 * Which of a channel's videos a breakdown studies. The choice is made here,
 * in code, by one rule for every channel: its videos are ranked by how far
 * each went above the channel's usual views, and the best are taken.
 */

/**
 * The videos the title formula, the thumbnail style, the description template
 * and the script rest on. A channel with fewer has all of them studied.
 */
export const BREAKDOWN_TOP_VIDEOS = 5;
/** The best of those, studied in depth: watched in full and gone through frame by frame. */
export const BREAKDOWN_DEEP_VIDEOS = 3;
/**
 * The bytes a second of the smallest watchable copy takes, which is YouTube's
 * 360p file with sound: a 15:48 video was listed at 75.2 MB, a little under
 * 80 kB a second.
 */
export const WATCH_BYTES_PER_SECOND = 80_000;
/**
 * The longest video worth downloading to be watched: what fits in the largest
 * file that is handed over (`MAX_VIDEO_BYTES`) at that rate, just under
 * twenty minutes. A longer one would be fetched and then refused for its size.
 */
export const WATCH_MAX_SECONDS = Math.floor(MAX_VIDEO_BYTES / WATCH_BYTES_PER_SECOND);

const SECOND_MS = 1000;

/** One video picked for a breakdown, with what the store knows of it. */
export interface BreakdownVideo {
  readonly videoId: string;
  readonly title: string;
  readonly views: number;
  /** Multiple of the channel's usual views; null when it cannot be judged. */
  readonly score: number | null;
  readonly durationSeconds: number | null;
}

export interface BreakdownPicks {
  /** How many videos of the channel are stored, so a reader can say what "top" was taken from. */
  readonly storedVideos: number;
  /** Up to `BREAKDOWN_TOP_VIDEOS`, best first. */
  readonly top: readonly BreakdownVideo[];
  /** The first `BREAKDOWN_DEEP_VIDEOS` of `top`. */
  readonly deep: readonly BreakdownVideo[];
}

/**
 * The videos to study for one channel: the five that went furthest above its
 * usual views, best first (a video too new or too alone to score comes after
 * the scored ones, by views), and the three best of those for study in depth.
 * A video whose id is not a YouTube video id is left out: the ids are put
 * into questions and file names.
 */
export function pickBreakdownVideos(videos: readonly StoredVideo[], now: Date): BreakdownPicks {
  const durations = new Map(videos.map((video) => [video.id, video.durationSeconds]));
  const top = buildVideoReport(videos, now)
    .filter((row) => VIDEO_ID_PATTERN.test(row.id))
    .slice(0, BREAKDOWN_TOP_VIDEOS)
    .map((row): BreakdownVideo => ({
      videoId: row.id,
      title: row.title,
      views: row.views,
      score: row.score,
      durationSeconds: durations.get(row.id) ?? null,
    }));
  return { storedVideos: videos.length, top, deep: top.slice(0, BREAKDOWN_DEEP_VIDEOS) };
}

/**
 * Why a video is not downloaded to be watched, in plain words, or null when
 * it may be tried: one whose stored length is over `WATCH_MAX_SECONDS` would
 * not fit in a file that can be handed over. A video whose length is not
 * stored is tried, and the downloader then says whether it fits.
 */
export function tooLongToWatch(video: Pick<BreakdownVideo, 'durationSeconds'>): string | null {
  const { durationSeconds } = video;
  if (durationSeconds === null || durationSeconds <= WATCH_MAX_SECONDS) return null;
  const length = clock(durationSeconds * SECOND_MS);
  const most = clock(WATCH_MAX_SECONDS * SECOND_MS);
  return `It is ${length} long, and a copy small enough for Jgtube to download holds about ${most} at most.`;
}
