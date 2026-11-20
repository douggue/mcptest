/**
 * What a finding says about itself, as it is kept in the store: one piece of
 * JSON in the `reason` column. The rules that decide what is a finding write
 * it; the alerts read it. Everything in it may be missing.
 */
import { z } from 'zod';
import type { FindingReason } from '../repos/types';

const MAX_WHY_LINES = 12;
const MAX_WHY_LENGTH = 500;
const MAX_KEYWORD_LENGTH = 200;

const count = z.number().int().nonnegative().nullable().default(null);
const region = z
  .string()
  .regex(/^[A-Z]{2}$/)
  .nullable()
  .default(null);

const storedReasonSchema = z.object({
  why: z.array(z.string().max(MAX_WHY_LENGTH)).max(MAX_WHY_LINES).default([]),
  totalViews: count,
  subscribers: count,
  channelCreatedAt: z.iso.datetime().nullable().default(null),
  channelCountry: region,
  subjectKeyword: z.string().max(MAX_KEYWORD_LENGTH).nullable().default(null),
  subjectRegion: region,
});

/** A finding that says nothing about itself. */
export const NO_REASON: FindingReason = {
  why: [],
  totalViews: null,
  subscribers: null,
  channelCreatedAt: null,
  channelCountry: null,
  subjectKeyword: null,
  subjectRegion: null,
};

/** The reason as text for the store. Throws when a figure or a code is out of shape. */
export function reasonToText(reason: FindingReason): string {
  const stored = storedReasonSchema.safeParse({
    ...reason,
    channelCreatedAt: reason.channelCreatedAt?.toISOString() ?? null,
  });
  if (!stored.success) {
    const problems = stored.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid finding reason. ${problems}`);
  }
  return JSON.stringify(stored.data);
}

/**
 * The reason read back from the store. Text that cannot be read gives a
 * reason that says nothing, so the finding can still be told of with the
 * figures its own columns hold.
 */
export function reasonFromText(text: string): FindingReason {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return NO_REASON;
  }
  const stored = storedReasonSchema.safeParse(raw);
  if (!stored.success) return NO_REASON;
  const createdAt = stored.data.channelCreatedAt;
  return { ...stored.data, channelCreatedAt: createdAt === null ? null : new Date(createdAt) };
}
