/**
 * What is kept of a thumbnail review: the tags of each thumbnail looked at,
 * reused across reviews, and per video the comparison code counted and the
 * answer written from it. Everything kept as JSON is checked again when read.
 */
import { z } from 'zod';
import type { ComparisonSet } from './compare';
import type { Counted } from './count';
import { TAG_ATTRIBUTES, thumbTagsSchema, type TagRejection, type ThumbTags } from './tags';

export interface ReviewedVideo {
  readonly videoId: string;
  readonly title: string;
  readonly channelId: string;
  readonly channelTitle: string;
  /** Multiple of its channel's usual views; null when it cannot be judged yet. */
  readonly score: number | null;
}

/** What code worked out for one video's thumbnail, before any answer is written. */
export interface ThumbComparison {
  readonly target: ReviewedVideo;
  readonly targetTags: ThumbTags | null;
  readonly set: ComparisonSet;
  readonly counted: Counted;
  /** Thumbnails whose tags were not kept, and why. */
  readonly rejected: readonly TagRejection[];
}

export interface ThumbAnswer {
  readonly text: string;
  readonly prompt: string | null;
  readonly engine: string;
  readonly writtenAt: Date;
}

export interface StoredThumbReview {
  readonly comparison: ThumbComparison;
  readonly comparedAt: Date;
  readonly answer: ThumbAnswer | null;
}

export interface ThumbReviewRepo {
  /** The kept tags of these thumbnails; a thumbnail never tagged is left out. */
  tagsFor(videoIds: readonly string[]): ReadonlyMap<string, ThumbTags>;
  saveTags(videoId: string, tags: ThumbTags, engine: string, at: Date): void;
  find(centerChannelId: string, videoId: string): StoredThumbReview | null;
  /** Keeps a new comparison for the video, dropping the answer written from the last one. */
  saveComparison(centerChannelId: string, comparison: ThumbComparison, at: Date): void;
  saveAnswer(centerChannelId: string, videoId: string, answer: ThumbAnswer): void;
  /** The videos of a channel's map with a kept review, newest first. */
  reviewed(centerChannelId: string): readonly string[];
}

const thumbSchema = z.object({
  videoId: z.string(),
  channelId: z.string(),
  channelTitle: z.string(),
  title: z.string(),
  score: z.number(),
  sameSubject: z.boolean(),
  pairedWith: z.string().nullable(),
});
const rowSchema = z.object({
  key: z.enum(TAG_ATTRIBUTES.map((attribute) => attribute.key) as [string, ...string[]]),
  label: z.string(),
  value: z.string(),
  winners: z.number(),
  winnersTagged: z.number(),
  winnerShare: z.number(),
  channels: z.number(),
  ordinary: z.number(),
  ordinaryTagged: z.number(),
  ordinaryShare: z.number().nullable(),
  lift: z.number().nullable(),
  yours: z.boolean(),
  flag: z.enum(['branding', 'topic']).nullable(),
  winning: z.boolean(),
  examples: z.array(z.string()),
});

/** The comparison as kept, checked when read. */
export const comparisonSchema = z.object({
  target: z.object({
    videoId: z.string(),
    title: z.string(),
    channelId: z.string(),
    channelTitle: z.string(),
    score: z.number().nullable(),
  }),
  targetTags: thumbTagsSchema.nullable(),
  set: z.object({ winners: z.array(thumbSchema), ordinary: z.array(thumbSchema) }),
  counted: z.object({
    rows: z.array(rowSchema),
    winnersTagged: z.number(),
    ordinaryTagged: z.number(),
    channels: z.number(),
    targetTagged: z.boolean(),
  }),
  rejected: z.array(z.object({ videoId: z.string(), reason: z.string() })),
});

/** The comparison as kept, or null when it cannot be read as one. */
export function readComparison(value: unknown): ThumbComparison | null {
  const parsed = comparisonSchema.safeParse(value);
  return parsed.success ? (parsed.data as ThumbComparison) : null;
}
