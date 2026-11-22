import { MAX_VIDEO_BYTES } from '../downloads/videoFile';
import { ORDINARY_MAX_SCORE, ORDINARY_MIN_AGE_DAYS } from '../map/thumbnails';
import { buildVideoReport, type VideoReportRow } from '../report';
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
/** The most videos the owner may have studied in depth: all the top ones. */
export const BREAKDOWN_MAX_DEEP_VIDEOS = 5;
/** Ordinary videos measured in code (no AI) beside the deep ones, for contrast. */
export const BREAKDOWN_CONTRAST_VIDEOS = 2;
/**
 * The titles a title study rests on at least, when the channel has that many:
 * the most viewed. A channel with more also has as many again of its least
 * viewed studied, so that what the strong titles share can be set against
 * what the weak ones lack. A channel with fewer has all of them studied.
 */
export const BREAKDOWN_TITLES = 20;
/** Ordinary videos set beside the top ones, to see what differs between them. */
export const BREAKDOWN_ORDINARY_VIDEOS = 5;
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
  /**
   * The videos whose titles are studied, most viewed first: the
   * `BREAKDOWN_TITLES` most viewed and, of the rest, up to as many of the
   * least viewed.
   */
  readonly titles: readonly BreakdownVideo[];
  /**
   * Up to `BREAKDOWN_ORDINARY_VIDEOS` that did what the channel usually does
   * or less, newest first, none of them among `top`.
   */
  readonly ordinary: readonly BreakdownVideo[];
}

/** Most viewed first; videos with the same views in one fixed order, by id. */
const byViews = (a: VideoReportRow, b: VideoReportRow): number =>
  b.views - a.views || a.id.localeCompare(b.id);

/** The most viewed `BREAKDOWN_TITLES` and, of the rest, up to as many of the least viewed. */
function pickTitles(rows: readonly VideoReportRow[]): readonly VideoReportRow[] {
  const ranked = [...rows].sort(byViews);
  const most = ranked.slice(0, BREAKDOWN_TITLES);
  const rest = ranked.slice(BREAKDOWN_TITLES);
  return [...most, ...rest.slice(-BREAKDOWN_TITLES)];
}

/** Scored at or under the channel's usual views and old enough to have shown it, newest first. */
function pickOrdinary(
  rows: readonly VideoReportRow[],
  top: readonly BreakdownVideo[],
): readonly VideoReportRow[] {
  const taken = new Set(top.map((video) => video.videoId));
  return rows
    .filter(
      (row) =>
        !taken.has(row.id) &&
        row.score !== null &&
        row.score <= ORDINARY_MAX_SCORE &&
        row.ageDays >= ORDINARY_MIN_AGE_DAYS,
    )
    .sort((a, b) => a.ageDays - b.ageDays)
    .slice(0, BREAKDOWN_ORDINARY_VIDEOS);
}

/**
 * The videos to study for one channel: the five that went furthest above its
 * usual views, best first (a video too new or too alone to score comes after
 * the scored ones, by views), and the three best of those for study in depth;
 * the titles to study, most viewed first; and a few ordinary videos to set
 * beside the top ones. A video whose id is not a YouTube video id is left
 * out: the ids are put into questions and file names.
 */
export function pickBreakdownVideos(
  videos: readonly StoredVideo[],
  now: Date,
  deepCount: number = BREAKDOWN_DEEP_VIDEOS,
): BreakdownPicks {
  const deepTaken = Math.max(1, Math.min(BREAKDOWN_MAX_DEEP_VIDEOS, Math.floor(deepCount)));
  const durations = new Map(videos.map((video) => [video.id, video.durationSeconds]));
  const picked = (row: VideoReportRow): BreakdownVideo => ({
    videoId: row.id,
    title: row.title,
    views: row.views,
    score: row.score,
    durationSeconds: durations.get(row.id) ?? null,
  });
  const rows = buildVideoReport(videos, now).filter((row) => VIDEO_ID_PATTERN.test(row.id));
  const top = rows.slice(0, BREAKDOWN_TOP_VIDEOS).map(picked);
  return {
    storedVideos: videos.length,
    top,
    deep: top.slice(0, deepTaken),
    titles: pickTitles(rows).map(picked),
    ordinary: pickOrdinary(rows, top).map(picked),
  };
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
