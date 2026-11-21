import type { ChannelHistory } from '../changes/changes';
import { winnerRows } from '../pacing/compare';
import type { CommentRead } from './store';

/** A winning video of the map whose comments can be read, strongest first. */
export interface CommentCandidate {
  readonly videoId: string;
  readonly title: string;
  readonly channelTitle: string;
  readonly score: number;
  readonly views: number;
  /** What is known of its comments; null when they were never read. */
  readonly read: CommentRead | null;
}

export function commentCandidates(
  lookalikes: readonly ChannelHistory[],
  now: Date,
  reads: ReadonlyMap<string, CommentRead>,
): readonly CommentCandidate[] {
  return [...winnerRows(lookalikes, now)]
    .sort((a, b) => b.score - a.score || b.video.views - a.video.views)
    .map(({ video, channel, score }) => ({
      videoId: video.id,
      title: video.title,
      channelTitle: channel.title,
      score,
      views: video.views,
      read: reads.get(video.id) ?? null,
    }));
}
