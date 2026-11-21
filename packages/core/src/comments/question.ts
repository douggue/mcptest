import type { CommentRepo, StoredComment } from './store';

/**
 * The comments one "What viewers ask for" may see: each chosen video's most
 * liked stored comments, up to a stated number. The connector tool hands out
 * exactly these, and an answer may quote no others.
 */

/** Per video: enough to see what recurs, few enough to read in one go. */
export const COMMENTS_IN_QUESTION = 60;

export function commentsForQuestion(
  comments: Pick<CommentRepo, 'listForVideos'>,
  videoIds: readonly string[],
): ReadonlyMap<string, readonly StoredComment[]> {
  const stored = comments.listForVideos(videoIds);
  return new Map(
    videoIds.map((videoId) => [
      videoId,
      stored.filter((comment) => comment.videoId === videoId).slice(0, COMMENTS_IN_QUESTION),
    ]),
  );
}
