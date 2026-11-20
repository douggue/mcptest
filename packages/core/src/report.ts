import type { StoredVideo } from './repos/types';
import { scoreVideos } from './scoring/outlier';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface VideoReportRow {
  readonly id: string;
  readonly title: string;
  readonly views: number;
  readonly ageDays: number;
  readonly publishedRaw: string;
  /** Multiple of the channel's usual views at this age; null when it cannot be judged. */
  readonly score: number | null;
  readonly baseline: number | null;
  /** How many other videos the baseline was taken from. */
  readonly sampleSize: number | null;
}

/** One channel's videos with outlier scores, strongest first and unscored last. */
export function buildVideoReport(
  videos: readonly StoredVideo[],
  now: Date,
): readonly VideoReportRow[] {
  const aged = videos.map((video) => ({
    video,
    ageDays: Math.max(0, (now.getTime() - video.published.date.getTime()) / DAY_MS),
  }));
  const scores = scoreVideos(
    aged.map(({ video, ageDays }) => ({ id: video.id, views: video.views, ageDays })),
  );
  const rows = aged.map(({ video, ageDays }): VideoReportRow => {
    const outlier = scores.get(video.id) ?? null;
    return {
      id: video.id,
      title: video.title,
      views: video.views,
      ageDays,
      publishedRaw: video.published.raw,
      score: outlier?.score ?? null,
      baseline: outlier?.baseline ?? null,
      sampleSize: outlier?.sampleSize ?? null,
    };
  });
  return [...rows].sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || b.views - a.views);
}
