/** The page's view of comment mining, built from the store for one centre channel. */
import {
  COMMENT_MINING_MAX_VIDEOS,
  COMMENT_UNITS_PER_VIDEO,
  commentCandidates,
  lookalikeHistories,
  type CommentCandidate,
  type CommentRepo,
  type HistoryDeps,
  type ViewerAnswer,
} from '@jgtube/core';
import type { CandidateView, CommentsView, FindingView } from './commentsTypes';

/** A key's default daily allowance in units, as Google sets it; the owner's may differ. */
export const DAILY_UNITS = 10_000;

export type CommentsDeps = HistoryDeps & { readonly comments: CommentRepo };

/** The map's winners, strongest first, with what is known of their comments; null with no map. */
export function candidatesOf(
  repos: CommentsDeps,
  center: string,
  now: Date,
): readonly CommentCandidate[] | null {
  const found = lookalikeHistories(repos, center, now);
  if (!found) return null;
  const first = commentCandidates(found.histories, now, new Map());
  return commentCandidates(
    found.histories,
    now,
    repos.comments.reads(first.map((entry) => entry.videoId)),
  );
}

const candidateView = (entry: CommentCandidate): CandidateView => ({
  ...entry,
  read: entry.read && { ...entry.read, readAt: entry.read.readAt.toISOString() },
});

/** A kept answer with each finding's comments as they were stored. */
function answerView(repos: CommentsDeps, answer: ViewerAnswer): CommentsView['answer'] {
  const stored = new Map(
    repos.comments.listForVideos(answer.videoIds).map((comment) => [comment.commentId, comment]),
  );
  const findings = answer.findings.map((finding): FindingView => ({
    kind: finding.kind,
    says: finding.says,
    comments: finding.commentIds.flatMap((id) => {
      const comment = stored.get(id);
      return comment
        ? [{ commentId: id, videoId: comment.videoId, text: comment.text, likes: comment.likes }]
        : [];
    }),
  }));
  return {
    videoIds: answer.videoIds,
    findings,
    engine: answer.engine,
    askedAt: answer.askedAt.toISOString(),
  };
}

export function commentsView(
  repos: CommentsDeps,
  center: string,
  now: Date,
  keySet: boolean,
): CommentsView | null {
  const candidates = candidatesOf(repos, center, now);
  if (candidates === null) return null;
  const answer = repos.comments.findAnswer(center);
  return {
    centerChannelId: center,
    keySet,
    unitsPerVideo: COMMENT_UNITS_PER_VIDEO,
    maxVideos: COMMENT_MINING_MAX_VIDEOS,
    dailyUnits: DAILY_UNITS,
    candidates: candidates.map(candidateView),
    answer: answer && answerView(repos, answer),
  };
}
