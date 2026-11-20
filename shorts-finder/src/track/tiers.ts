/**
 * How often a tracked video is read. Reading every found video hourly for
 * three days would spend the reading share several times over, so readings
 * go where a video shows promise: by its place in a group of comparable
 * videos (see `promise.ts`), not by its age alone.
 *
 * Every rule here is a position in a group or a named span of time. None is
 * a number of views, and none knows any subject.
 */
import type { FinishReason, Tier } from '../repos/types';
import { speedingUp, type ViewReading } from './velocity';

const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;

export const HOURLY_READ_MS = MS_PER_HOUR;
export const SIX_HOURLY_READ_MS = 6 * MS_PER_HOUR;
/**
 * Hourly readings are for the first 72 hours after publication: the days in
 * which a Short is offered to new viewers fastest, and in which an hour's
 * gain says the most about where it is heading.
 */
export const HOURLY_UNTIL_MS = 72 * MS_PER_HOUR;
/**
 * After two weeks a video is no longer news to a finder of new things, and
 * its readings stop whatever its place.
 */
export const TRACKED_UNTIL_MS = 14 * MS_PER_DAY;
/**
 * A round of readings takes every video due within the next five minutes as
 * well as those already due. Rounds are an hour apart and a video's next read
 * is set an hour after its round began, a few milliseconds after the
 * scheduler noted the round's start; without this margin every video would be
 * "not quite due" at the next round and wait a second hour. Five minutes is
 * the scheduler's own look interval: nothing due inside it could be read any
 * sooner by waiting.
 */
export const DUE_LOOK_AHEAD_MS = 5 * 60 * 1000;
/** The upper half of a group: at or above the middle place. */
export const TOP_HALF_FROM = 0.5;
/**
 * A video whose channel is in the top quarter of its group by subscribers is
 * not what the finder is looking for, but its readings say what "ordinary"
 * looks like at each age. It is read only at about these two ages.
 */
export const BASELINE_FROM = 0.75;
export const BASELINE_READ_AGES_MS: readonly number[] = [24 * MS_PER_HOUR, 72 * MS_PER_HOUR];
/**
 * Three readings in a row in the slower half of its group, without speeding
 * up, end a video's tracking: on the six-hourly tier that is most of a day of
 * being ordinary, and one slow reading or two can be a quiet night.
 */
export const FADE_AFTER_LOW_READINGS = 3;

/** Where a video stands in its group; null where its figure is not known. */
export interface Position {
  /** Its place by views per hour, 0 to 1. */
  readonly speedPercentile: number | null;
  /** Its channel's place by subscribers among the group's channels, 0 to 1. */
  readonly channelSizePercentile: number | null;
}

export const NO_POSITION: Position = { speedPercentile: null, channelSizePercentile: null };

export interface PlanInput {
  readonly publishedAt: Date;
  /** The start of the round, which next reads are counted from. */
  readonly now: Date;
  /** The video's readings so far, this round's included. */
  readonly readings: readonly ViewReading[];
  readonly position: Position;
  /** How many readings in a row, before this one, found it in the slower half. */
  readonly lowStreak: number;
}

export type ReadPlan =
  | {
      readonly tier: Exclude<Tier, 'done'>;
      readonly nextReadAt: Date;
      readonly lowStreak: number;
    }
  | {
      readonly tier: 'done';
      readonly nextReadAt: null;
      readonly reason: FinishReason;
      readonly lowStreak: number;
    };

const after = (now: Date, ms: number): Date => new Date(now.getTime() + ms);

const done = (reason: FinishReason, lowStreak: number): ReadPlan => ({
  tier: 'done',
  nextReadAt: null,
  reason,
  lowStreak,
});

/** A baseline video's next reading: the first of its two ages still to come. */
function baselinePlan(input: PlanInput, age: number): ReadPlan {
  const next = BASELINE_READ_AGES_MS.find((readAge) => readAge > age);
  if (next === undefined) return done('baseline_done', 0);
  const nextReadAt = new Date(input.publishedAt.getTime() + next);
  return { tier: 'baseline', nextReadAt, lowStreak: 0 };
}

/**
 * What a reading means for a video's next one.
 *
 * - Past 14 days: tracking ends.
 * - A channel in the top quarter of the group by subscribers: read only at
 *   about 24 and 72 hours, for the baseline.
 * - Otherwise hourly while under 72 hours old and in the upper half of the
 *   group by views per hour; six-hourly when not.
 * - Three readings in a row in the slower half, the last without speeding up:
 *   tracking ends.
 *
 * A video with no known place (no view count, or alone in its group in a way
 * that says nothing) is given the benefit of the doubt and read by its age.
 */
export function planNextRead(input: PlanInput): ReadPlan {
  const { now, position } = input;
  const age = now.getTime() - input.publishedAt.getTime();
  if (age >= TRACKED_UNTIL_MS) return done('aged_out', input.lowStreak);
  const size = position.channelSizePercentile;
  if (size !== null && size >= BASELINE_FROM) return baselinePlan(input, age);
  const speed = position.speedPercentile;
  const inLowerHalf = speed !== null && speed < TOP_HALF_FROM;
  const lowStreak = inLowerHalf ? input.lowStreak + 1 : 0;
  if (lowStreak >= FADE_AFTER_LOW_READINGS && !speedingUp(input.readings)) {
    return done('faded', lowStreak);
  }
  if (age < HOURLY_UNTIL_MS && !inLowerHalf) {
    return { tier: 'hourly', nextReadAt: after(now, HOURLY_READ_MS), lowStreak };
  }
  return { tier: 'six_hourly', nextReadAt: after(now, SIX_HOURLY_READ_MS), lowStreak };
}

/**
 * The tier a newly found video starts on and when it is first read again: by
 * its age alone, since it has no place in a group before its second reading.
 * Null for a video already past the age at which tracking ends.
 */
export function initialPlan(
  publishedAt: Date,
  now: Date,
): { readonly tier: 'hourly' | 'six_hourly'; readonly nextReadAt: Date } | null {
  const age = now.getTime() - publishedAt.getTime();
  if (age >= TRACKED_UNTIL_MS) return null;
  return age < HOURLY_UNTIL_MS
    ? { tier: 'hourly', nextReadAt: after(now, HOURLY_READ_MS) }
    : { tier: 'six_hourly', nextReadAt: after(now, SIX_HOURLY_READ_MS) };
}

/**
 * When to ask again for a video a read learnt nothing of (the API left it
 * out, or its entry could not be read): on the tier it is on, with a
 * baseline video asked for again at the slower pace. Null past 14 days.
 */
export function retryPlan(
  tier: Exclude<Tier, 'done'>,
  publishedAt: Date,
  now: Date,
): { readonly tier: Exclude<Tier, 'done'>; readonly nextReadAt: Date } | null {
  if (now.getTime() - publishedAt.getTime() >= TRACKED_UNTIL_MS) return null;
  const wait = tier === 'hourly' ? HOURLY_READ_MS : SIX_HOURLY_READ_MS;
  return { tier, nextReadAt: after(now, wait) };
}
