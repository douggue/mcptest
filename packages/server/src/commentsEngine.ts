/**
 * Comment mining for one centre channel. Reading comments needs the owner's
 * YouTube API key, read at the time of use; asking needs an AI engine, which
 * reads the comments through a read-only connector tool and is never handed
 * them in its question. What it answers is checked in code before it is kept.
 */
import {
  COMMENT_MINING_MAX_VIDEOS,
  commentsForQuestion,
  fetchTopComments,
  mineComments,
  parseViewerFindings,
  verifyFindings,
  type CommentsResult,
} from '@jgtube/core';
import type { Engine } from './app';
import type { CommentsEngine } from './commentsTypes';
import { candidatesOf, commentsView, type CommentsDeps } from './commentsView';

export { DAILY_UNITS } from './commentsView';

const NO_MAP = 'No map has been made for this channel yet';
const NO_KEY =
  'No YouTube API key is set. Reading comments needs the official API: put a key in Settings.';

export interface CommentsEngineDeps {
  readonly now: () => Date;
  readonly repos: CommentsDeps;
  /** The owner's key as it is set now; undefined when none is. */
  readonly apiKey: () => string | undefined;
  /** Replaces the network; used by tests. */
  readonly fetchComments?: (videoId: string, apiKey: string) => Promise<CommentsResult>;
  readonly analyse: Engine['analyse'];
}

/** The ids, checked to be winners of this map; throws with the reason otherwise. */
function winnersOf(
  deps: CommentsEngineDeps,
  center: string,
  videoIds: readonly string[],
): readonly string[] {
  const candidates = candidatesOf(deps.repos, center, deps.now());
  if (candidates === null) throw new Error(NO_MAP);
  if (videoIds.length === 0 || videoIds.length > COMMENT_MINING_MAX_VIDEOS) {
    throw new Error(`Choose from 1 to at most ${COMMENT_MINING_MAX_VIDEOS} videos.`);
  }
  const winners = new Set(candidates.map((entry) => entry.videoId));
  const stranger = videoIds.find((id) => !winners.has(id));
  if (stranger !== undefined) {
    throw new Error(`The video ${stranger} is not among the winning videos of this map.`);
  }
  return [...new Set(videoIds)];
}

export function commentsEngine(deps: CommentsEngineDeps): CommentsEngine {
  const { repos, now } = deps;
  const fetchComments =
    deps.fetchComments ?? ((videoId, apiKey) => fetchTopComments(videoId, { apiKey }));
  const keyOf = (): string | null => {
    const key = deps.apiKey()?.trim() ?? '';
    return key === '' ? null : key;
  };

  return {
    findComments: (center) => commentsView(repos, center, now(), keyOf() !== null),

    async readComments(center, videoIds, onProgress) {
      const chosen = winnersOf(deps, center, videoIds);
      if (keyOf() === null) throw new Error(NO_KEY);
      const read = (videoId: string) => {
        const key = keyOf();
        if (key === null) throw new Error(NO_KEY);
        return fetchComments(videoId, key);
      };
      return mineComments(
        { comments: repos.comments, fetchComments: read, now },
        chosen,
        onProgress,
      );
    },

    async askViewers(center, videoIds, only) {
      const chosen = winnersOf(deps, center, videoIds);
      const handed = commentsForQuestion(repos.comments, chosen);
      const sent = new Set([...handed.values()].flat().map((comment) => comment.commentId));
      if (chosen.some((id) => (handed.get(id) ?? []).length === 0)) {
        throw new Error('Some of these videos have no stored comments. Read their comments first.');
      }
      const answer = await deps.analyse('viewer-requests', center, only, {
        kind: 'comments',
        videoIds: chosen,
      });
      const { findings, unread } = parseViewerFindings(answer.text);
      const { kept, dropped } = verifyFindings(findings, sent);
      repos.comments.saveAnswer(center, {
        videoIds: chosen,
        findings: kept,
        engine: answer.engine,
        askedAt: now(),
      });
      return { proposed: findings.length, dropped, unread, engine: answer.engine };
    },

    viewerComments(center, videoIds) {
      const candidates = candidatesOf(repos, center, now());
      if (candidates === null) return null;
      const winners = new Map(candidates.map((entry) => [entry.videoId, entry]));
      const chosen = [...new Set(videoIds)].filter((id) => winners.has(id));
      const handed = commentsForQuestion(repos.comments, chosen);
      return {
        videos: chosen.map((videoId) => ({
          videoId,
          title: winners.get(videoId)?.title ?? '',
          channelTitle: winners.get(videoId)?.channelTitle ?? '',
          comments: (handed.get(videoId) ?? []).map((c) => ({
            id: c.commentId,
            text: c.text,
            likes: c.likes,
          })),
        })),
      };
    },
  };
}
