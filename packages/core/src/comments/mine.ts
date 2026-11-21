import type { CommentsResult } from '../sources/commentsApi';
import { ApiRefusal, QUOTA_REASONS } from '../sources/dataApi';
import type { CommentRepo } from './store';

/**
 * Reads the comments of chosen videos from the official API, one video at a
 * time, and keeps them. A video that cannot be read is reported and the next
 * is tried; once the key's daily allowance is used up the rest are skipped.
 */

/** The most videos read in one go: ten units of a key's 10,000 a day. */
export const COMMENT_MINING_MAX_VIDEOS = 10;

export interface MineDeps {
  readonly comments: Pick<CommentRepo, 'saveRead'>;
  /** Reads one video's comments; the key is read at the time of use, inside it. */
  readonly fetchComments: (videoId: string) => Promise<CommentsResult>;
  readonly now: () => Date;
}

export interface MineOutcome {
  readonly videoId: string;
  /** 'skipped' after the daily allowance ran out. */
  readonly status: CommentsResult['status'] | 'failed' | 'skipped';
  readonly count: number;
  readonly problem: string | null;
}

const isQuota = (error: unknown): boolean =>
  error instanceof ApiRefusal && error.reasons.some((reason) => QUOTA_REASONS.includes(reason));

async function mineOne(deps: MineDeps, videoId: string): Promise<MineOutcome> {
  try {
    const result = await deps.fetchComments(videoId);
    deps.comments.saveRead(videoId, result, deps.now());
    return { videoId, status: result.status, count: result.comments.length, problem: null };
  } catch (error) {
    if (isQuota(error)) throw error;
    const problem = error instanceof Error ? error.message : 'It could not be read';
    return { videoId, status: 'failed', count: 0, problem };
  }
}

export async function mineComments(
  deps: MineDeps,
  videoIds: readonly string[],
  onProgress: (done: number, total: number) => void = () => {},
): Promise<readonly MineOutcome[]> {
  const outcomes: MineOutcome[] = [];
  for (const videoId of videoIds) {
    try {
      outcomes.push(await mineOne(deps, videoId));
    } catch (error) {
      const problem = error instanceof Error ? error.message : 'The daily allowance is used up';
      outcomes.push({ videoId, status: 'failed', count: 0, problem });
      const rest = videoIds.slice(outcomes.length);
      outcomes.push(
        ...rest.map((id): MineOutcome => ({
          videoId: id,
          status: 'skipped',
          count: 0,
          problem: null,
        })),
      );
      break;
    }
    onProgress(outcomes.length, videoIds.length);
  }
  return outcomes;
}
