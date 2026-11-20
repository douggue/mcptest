import { buildVideoReport } from '../report';
import type { StoredVideo, StoredVideoDetails } from '../repos/types';

/**
 * A video's description and tags beside what the store already knows of it:
 * its views and how it did against its channel's usual. A title formula or a
 * description template is read off the videos that worked, so the two belong
 * side by side.
 */

/** The parts of the stored videos this needs, so a test can stand in for the store. */
export interface StoredVideoLookup {
  findById(videoId: string): StoredVideo | null;
  listByChannel(channelId: string): readonly StoredVideo[];
}

export interface VideoFacts {
  readonly videoId: string;
  /** Null when the video is not in the store: no crawl has read its channel. */
  readonly channelId: string | null;
  readonly title: string | null;
  readonly description: string;
  readonly tags: readonly string[];
  readonly durationSeconds: number | null;
  /** Null when the video is not in the store. */
  readonly views: number | null;
  /** Multiple of its channel's usual views; null when it cannot be judged. */
  readonly score: number | null;
}

/**
 * Each video's details with its stored views, length and score. A channel's
 * scores are worked out once however many of its videos are asked about.
 */
export function describeVideos(
  videos: StoredVideoLookup,
  details: readonly StoredVideoDetails[],
  now: Date,
): readonly VideoFacts[] {
  const scores = new Map<string, ReadonlyMap<string, number | null>>();
  const scoresOf = (channelId: string): ReadonlyMap<string, number | null> => {
    const known = scores.get(channelId);
    if (known) return known;
    const report = buildVideoReport(videos.listByChannel(channelId), now);
    const worked = new Map(report.map((row) => [row.id, row.score]));
    scores.set(channelId, worked);
    return worked;
  };
  return details.map((entry): VideoFacts => {
    const stored = videos.findById(entry.videoId);
    return {
      videoId: entry.videoId,
      channelId: stored?.channelId ?? null,
      title: stored?.title ?? entry.title,
      description: entry.description,
      tags: entry.tags,
      durationSeconds: stored?.durationSeconds ?? entry.durationSeconds,
      views: stored?.views ?? null,
      score: stored ? (scoresOf(stored.channelId).get(stored.id) ?? null) : null,
    };
  });
}
