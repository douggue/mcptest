/**
 * The per-video thumbnail review for one centre channel. Code chooses the
 * winners to compare with, an engine tags the thumbnails not yet tagged
 * (kept for later reviews), code counts, and an engine writes the advice
 * from the count alone. See `thumbReviewQuestions.ts`.
 */
import {
  buildVideoReport,
  chooseComparison,
  comparisonText,
  countComparison,
  loadThumbnailBoard,
  MAX_THUMBNAIL_PROMPT_CHARS,
  THUMBNAIL_PROMPT_MARKER,
  splitMarked,
  parseTagAnswer,
  type SnapshotDeps,
  type StoredThumbReview,
  type TagRejection,
  type ThumbReviewRepo,
  type ThumbnailBoard,
} from '@jgtube/core';
import type { Engine } from './app';
import { THUMB_TAG_IDS_MAX } from './thumbReviewQuestions';
import type {
  PickableVideo,
  ThumbReviewEngine,
  ThumbReviewView,
} from './thumbReviewTypes';

const MAX_OWN = 30;
const MAX_MAP = 40;
const NOT_ON_MAP = 'That video is not one of this map’s stored videos.';
const NO_WINNERS = 'This map has no winning videos to compare with yet.';
const NOT_TAGGED = 'Your thumbnail could not be looked at, so there is nothing to compare.';

export interface ThumbReviewDeps {
  readonly now: () => Date;
  readonly repos: SnapshotDeps & { readonly thumbReviews: ThumbReviewRepo };
  readonly analyse: Engine['analyse'];
}

function ownVideos(deps: ThumbReviewDeps, board: ThumbnailBoard): readonly PickableVideo[] {
  const { center } = board;
  return buildVideoReport(deps.repos.videos.listByChannel(center.id), deps.now())
    .map((row) => ({
      videoId: row.id,
      title: row.title,
      channelId: center.id,
      channelTitle: center.title,
      score: row.score,
      ageDays: row.ageDays,
    }))
    .sort((a, b) => a.ageDays - b.ageDays)
    .slice(0, MAX_OWN);
}

function mapVideos(board: ThumbnailBoard): readonly PickableVideo[] {
  return board.channels
    .flatMap((channel) =>
      [...channel.winners, ...channel.ordinary].map((video) => ({
        videoId: video.videoId,
        title: video.title,
        channelId: channel.id,
        channelTitle: channel.title,
        score: video.score,
        ageDays: video.ageDays,
      })),
    )
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}

function viewOf(stored: StoredThumbReview): ThumbReviewView {
  const { comparison, comparedAt, answer } = stored;
  const { counted, target } = comparison;
  return {
    target: { ...target, ageDays: 0, tags: comparison.targetTags },
    winners: comparison.set.winners,
    ordinary: comparison.set.ordinary,
    rows: counted.rows,
    winnersTagged: counted.winnersTagged,
    ordinaryTagged: counted.ordinaryTagged,
    channels: counted.channels,
    rejected: comparison.rejected,
    comparedAt: comparedAt.toISOString(),
    answer: answer && { ...answer, writtenAt: answer.writtenAt.toISOString() },
  };
}

/** A heading the prompt sits under, left behind once the prompt is lifted out. */
const PROMPT_HEADING = /\n*THE PROMPT:?\s*$/;

/** The advice as shown, and the prompt lifted out from between its marker lines; null when none. */
export function adviceParts(answer: string): {
  readonly text: string;
  readonly prompt: string | null;
} {
  const { marked, rest } = splitMarked(answer, THUMBNAIL_PROMPT_MARKER);
  if (marked === null || marked.length > MAX_THUMBNAIL_PROMPT_CHARS) {
    return { text: answer, prompt: null };
  }
  return { text: rest.replace(PROMPT_HEADING, '').trim(), prompt: marked };
}

const chunks = <T>(items: readonly T[], size: number): readonly (readonly T[])[] =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, index * size + size),
  );

export function thumbReviewEngine(deps: ThumbReviewDeps): ThumbReviewEngine {
  const { repos, now, analyse } = deps;
  const boardOf = (center: string): ThumbnailBoard | null =>
    loadThumbnailBoard(repos, center, now());

  /** Tags the thumbnails not yet tagged, in batches; returns what was not kept, and who tagged. */
  async function tagMissing(
    center: string,
    videoIds: readonly string[],
    only: Parameters<Engine['analyse']>[2],
  ): Promise<{ readonly rejected: readonly TagRejection[]; readonly engines: readonly string[] }> {
    const kept = repos.thumbReviews.tagsFor(videoIds);
    const missing = videoIds.filter((id) => !kept.has(id));
    const results = [];
    for (const batch of chunks(missing, THUMB_TAG_IDS_MAX)) {
      const focus = { kind: 'thumb-tags', videoIds: batch } as const;
      const reply = await analyse('thumbnail-tags', center, only, focus);
      const parsed = parseTagAnswer(reply.text, batch);
      for (const [id, tags] of parsed.tags)
        repos.thumbReviews.saveTags(id, tags, reply.engine, now());
      results.push({ rejected: parsed.rejected, engine: reply.engine });
    }
    return {
      rejected: results.flatMap((result) => result.rejected),
      engines: [...new Set(results.map((result) => result.engine))],
    };
  }

  return {
    thumbnailVideos(center) {
      const board = boardOf(center);
      if (!board) return null;
      return {
        own: ownVideos(deps, board),
        map: mapVideos(board).slice(0, MAX_MAP),
        reviewed: repos.thumbReviews.reviewed(center),
      };
    },

    findThumbnailReview(center, videoId) {
      const stored = repos.thumbReviews.find(center, videoId);
      return stored ? viewOf(stored) : null;
    },

    thumbnailComparison(center, videoId) {
      const stored = repos.thumbReviews.find(center, videoId);
      return stored ? comparisonText(stored.comparison) : null;
    },

    async askThumbnailReview(center, videoId, only, report = () => undefined) {
      const board = boardOf(center);
      const target = board
        ? [...ownVideos(deps, board), ...mapVideos(board)].find(
            (video) => video.videoId === videoId,
          )
        : undefined;
      if (!board || !target) throw new Error(NOT_ON_MAP);
      const set = chooseComparison(board, target);
      if (set.winners.length === 0) throw new Error(NO_WINNERS);
      const ids = [
        target.videoId,
        ...[...set.winners, ...set.ordinary].map((thumb) => thumb.videoId),
      ];
      report(
        `Looking at ${ids.length} thumbnails: yours, ${set.winners.length} winners and their ordinary counterparts`,
      );
      const tagging = await tagMissing(center, ids, only);
      const tags = repos.thumbReviews.tagsFor(ids);
      if (!tags.has(target.videoId)) throw new Error(NOT_TAGGED);
      const counted = countComparison(set, tags, target.videoId);
      repos.thumbReviews.saveComparison(
        center,
        {
          target: {
            videoId: target.videoId,
            title: target.title,
            channelId: target.channelId,
            channelTitle: target.channelTitle,
            score: target.score,
          },
          targetTags: tags.get(target.videoId) ?? null,
          set,
          counted,
          rejected: tagging.rejected,
        },
        now(),
      );
      report('Counted what the winners share; asking for the advice and the prompt');
      const advice = await analyse('thumbnail-advice', center, only, {
        kind: 'thumb-advice',
        videoId,
      });
      const { prompt, text } = adviceParts(advice.text);
      repos.thumbReviews.saveAnswer(center, videoId, {
        text,
        prompt,
        engine: advice.engine,
        writtenAt: now(),
      });
      return {
        winners: set.winners.length,
        tagged: counted.winnersTagged + counted.ordinaryTagged + 1,
        rejected: tagging.rejected.length,
        engine: advice.engine,
      };
    },
  };
}
