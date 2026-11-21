/**
 * A video's top-level comments from the official YouTube Data API
 * (`commentThreads.list`), most relevant first, one page per video.
 *
 * It needs the owner's own API key, sent only in a request header (as every
 * call in `dataApi.ts` sends it), and costs one unit of the key's daily
 * allowance (10,000 by default) per video. Comments are text written by
 * strangers: they are kept as data and are never put into a question. Who
 * wrote them is not kept.
 */
import { z } from 'zod';
import { ApiRefusal, apiGet, requireKey, type DataApiOptions } from './dataApi';
import { VIDEO_ID_PATTERN } from './parse';

/** One page, the most the API returns at once. */
export const COMMENTS_PER_VIDEO = 100;
/** What one page costs from the key's daily allowance. */
export const COMMENT_UNITS_PER_VIDEO = 1;
/** Longer comments are cut here; a request or a question is said well before it. */
export const MAX_COMMENT_CHARS = 2000;
const DISABLED_REASON = 'commentsDisabled';
const MAX_ID_CHARS = 100;

export interface FetchedComment {
  readonly commentId: string;
  readonly videoId: string;
  readonly text: string;
  readonly likes: number;
  readonly publishedAt: Date;
}

export interface CommentsResult {
  /** 'disabled' when the video has its comments turned off. */
  readonly status: 'read' | 'disabled';
  readonly comments: readonly FetchedComment[];
}

const threadSchema = z.object({
  snippet: z.object({
    videoId: z.string().regex(VIDEO_ID_PATTERN),
    topLevelComment: z.object({
      id: z.string().min(1).max(MAX_ID_CHARS),
      snippet: z.object({
        textOriginal: z.string(),
        likeCount: z.number().int().nonnegative().optional(),
        publishedAt: z
          .string()
          .transform((text) => new Date(text))
          .refine((date) => !Number.isNaN(date.getTime())),
      }),
    }),
  }),
});

const replySchema = z.object({ items: z.array(z.unknown()).optional() });

function toComment(raw: unknown): FetchedComment | null {
  const parsed = threadSchema.safeParse(raw);
  if (!parsed.success) return null;
  const { videoId, topLevelComment } = parsed.data.snippet;
  const { textOriginal, likeCount, publishedAt } = topLevelComment.snippet;
  return {
    commentId: topLevelComment.id,
    videoId,
    text: textOriginal.slice(0, MAX_COMMENT_CHARS),
    likes: likeCount ?? 0,
    publishedAt,
  };
}

/** Reads one page of a video's top-level comments; refusals other than "turned off" are thrown. */
export async function fetchTopComments(
  videoId: string,
  options: DataApiOptions,
): Promise<CommentsResult> {
  const apiKey = requireKey(options.apiKey);
  if (!VIDEO_ID_PATTERN.test(videoId)) {
    throw new Error(`Not a valid YouTube video id: "${videoId.slice(0, 40)}"`);
  }
  const query = new URLSearchParams({
    part: 'snippet',
    videoId,
    maxResults: String(COMMENTS_PER_VIDEO),
    order: 'relevance',
    textFormat: 'plainText',
  });
  try {
    const reply = replySchema.safeParse(
      await apiGet('commentThreads', query, apiKey, options.fetch ?? fetch),
    );
    if (!reply.success) throw new Error('The YouTube API sent a reply that could not be read');
    return {
      status: 'read',
      comments: (reply.data.items ?? []).flatMap((raw) => toComment(raw) ?? []),
    };
  } catch (error) {
    if (error instanceof ApiRefusal && error.reasons.includes(DISABLED_REASON)) {
      return { status: 'disabled', comments: [] };
    }
    throw error;
  }
}
