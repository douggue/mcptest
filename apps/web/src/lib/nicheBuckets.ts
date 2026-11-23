/**
 * Which range a listed channel falls in for each filter on New niches. Every
 * key is worked out from the numbers the niche list already carries; nothing
 * here reads or guesses anything new.
 */
import type { EarningsEstimate, NicheChannel } from '@jgtube/core';
import { accountAgeDays, countryName, isRestarted } from './niches';

/** Under 3 months, 3 to 6 months, 6 to 12 months, over a year, then the two marks apart. */
export type AgeKey = 'new' | 'under-6m' | 'under-1y' | 'older' | 'restarted' | 'unknown';
export type RevenueKey = 'under-1k' | '1k-3k' | '3k-5k' | '5k-10k' | '10k-plus' | 'none';
/**
 * Bands of the estimate's RPM. The estimate values long videos at $2–8 per
 * 1,000 views times the country tier (1, 0.5 or 0.2) and Shorts at $0.10–0.50,
 * so its middle RPM runs from $0.30 (all Shorts) to $5 (long videos, top tier):
 * no band above $5 could ever hold a channel.
 */
export type RpmKey = 'under-0.5' | '0.5-1' | '1-2' | '2-3' | '3-plus' | 'none';
export type SizeKey = 'under-1k' | '1k-10k' | '10k-100k' | 'hidden';
export type UploadsKey = 'under-1' | '1-3' | '3-7' | '7-plus';
/** The multiples a best video can reach, each kept when it is reached. */
export const TOOK_OFF_STEPS = [5, 10, 50] as const;

/** The day each age range ends before: 90 days and under is new, as on the niche list. */
const AGE_LIMITS: readonly (readonly [AgeKey, number])[] = [
  ['new', 91],
  ['under-6m', 183],
  ['under-1y', 366],
];
const REVENUE_LIMITS: readonly (readonly [RevenueKey, number])[] = [
  ['under-1k', 1000],
  ['1k-3k', 3000],
  ['3k-5k', 5000],
  ['5k-10k', 10_000],
];
const RPM_LIMITS: readonly (readonly [RpmKey, number])[] = [
  ['under-0.5', 0.5],
  ['0.5-1', 1],
  ['1-2', 2],
  ['2-3', 3],
];
const VIEWS_PER_RPM = 1000;
const SIZE_LIMITS: readonly (readonly [SizeKey, number])[] = [
  ['under-1k', 1000],
  ['1k-10k', 10_000],
];
const UPLOAD_LIMITS: readonly (readonly [UploadsKey, number])[] = [
  ['under-1', 1],
  ['1-3', 3],
  ['3-7', 7],
];
const WINDOW_DAYS = 30;
const DAYS_A_WEEK = 7;
const COUNTRY_CODE = /^[A-Z]{2}$/;

/** The first range whose upper end the value stays under, or `rest` past them all. */
function rangeOf<K extends string>(
  value: number,
  limits: readonly (readonly [K, number])[],
  rest: K,
): K {
  return limits.find(([, limit]) => value < limit)?.[0] ?? rest;
}

/** The alphabet of the channel's titles: 'latin', the script's name, or 'other' when unnamed. */
export function languageKey(channel: Pick<NicheChannel, 'otherLanguage'>): string {
  if (channel.otherLanguage === null) return 'latin';
  return channel.otherLanguage.script ?? 'other';
}

/**
 * How old the channel is, from its first upload, or from the account when the
 * first upload is not known (a channel is never older than its account); and
 * "restarted" beside it when the account is far older than the first upload.
 */
export function ageKeys(channel: NicheChannel, now: Date): readonly AgeKey[] {
  const days = channel.channelAgeDays ?? accountAgeDays(channel, now);
  if (days === null) return ['unknown'];
  const age = rangeOf(days, AGE_LIMITS, 'older');
  return isRestarted(channel, now) ? [age, 'restarted'] : [age];
}

/** The middle of an estimate's range, in dollars. */
export function estimateMiddle(estimate: Pick<EarningsEstimate, 'low' | 'high'>): number {
  return (estimate.low + estimate.high) / 2;
}

/** The range of the 30-day estimate's middle; 'none' when there were no uploads to value. */
export function revenueKey(channel: Pick<NicheChannel, 'earnings'>): RevenueKey {
  if (channel.earnings.high <= 0) return 'none';
  return rangeOf(estimateMiddle(channel.earnings), REVENUE_LIMITS, '10k-plus');
}

/** Dollars per 1,000 views at the low end, middle and high end of an estimate. */
export interface Rpm {
  readonly low: number;
  readonly middle: number;
  readonly high: number;
}

/**
 * The RPM the 30-day estimate works out to: its dollars over the views it was
 * made from, per 1,000. Null when there were no views to value.
 */
export function rpmOf(channel: Pick<NicheChannel, 'earnings'>): Rpm | null {
  const { earnings } = channel;
  const views = earnings.longFormViews + earnings.shortsViews;
  if (views <= 0 || earnings.high <= 0) return null;
  const per = (dollars: number): number => (dollars / views) * VIEWS_PER_RPM;
  return {
    low: per(earnings.low),
    middle: per(estimateMiddle(earnings)),
    high: per(earnings.high),
  };
}

/** The band of the estimate's middle RPM; 'none' when there is no estimate. */
export function rpmKey(channel: Pick<NicheChannel, 'earnings'>): RpmKey {
  const rpm = rpmOf(channel);
  return rpm === null ? 'none' : rangeOf(rpm.middle, RPM_LIMITS, '3-plus');
}

export function sizeKey(channel: Pick<NicheChannel, 'subscribers'>): SizeKey {
  if (channel.subscribers === null) return 'hidden';
  return rangeOf(channel.subscribers, SIZE_LIMITS, '10k-100k');
}

/** The highest multiple among the videos that took off; null when none could be scored. */
export function bestScore(channel: Pick<NicheChannel, 'outperformers'>): number | null {
  const scores = channel.outperformers.flatMap((video) =>
    video.score === null ? [] : [video.score],
  );
  return scores.length === 0 ? null : Math.max(...scores);
}

/** Each step the best video reached, as '5', '10' and '50'. */
export function tookOffKeys(channel: Pick<NicheChannel, 'outperformers'>): readonly string[] {
  const best = bestScore(channel);
  if (best === null) return [];
  return TOOK_OFF_STEPS.filter((step) => best >= step).map(String);
}

/** Uploads a week, from the uploads of the last 30 days. */
export function uploadsPerWeek(channel: Pick<NicheChannel, 'recentUploads'>): number {
  return (channel.recentUploads * DAYS_A_WEEK) / WINDOW_DAYS;
}

export function uploadsKey(channel: Pick<NicheChannel, 'recentUploads'>): UploadsKey {
  return rangeOf(uploadsPerWeek(channel), UPLOAD_LIMITS, '7-plus');
}

/** The country code when it names a country, 'unknown' otherwise. */
export function countryKey(channel: Pick<NicheChannel, 'country'>): string {
  const code = channel.country;
  return code !== null && COUNTRY_CODE.test(code) && countryName(code) !== null ? code : 'unknown';
}

const TOPIC_FROM: Readonly<Record<NicheChannel['topic']['source'], string>> = {
  keywords: 'From the keywords and description the channel set for itself.',
  titles: 'From the words of its titles, a rare word counting for more than a common one.',
  none: 'Other: neither its keywords nor its titles point clearly to one subject.',
};

/** Where a channel's topic label came from, for its tooltip. */
export function describeTopicSource(topic: NicheChannel['topic']): string {
  return TOPIC_FROM[topic.source];
}

/** Dollars to two places under $1 and to one place above, as RPMs are usually written. */
const rpmDollars = (value: number): string => `$${value.toFixed(value < 1 ? 2 : 1)}`;

/** The estimate's RPM in words, or why there is none. */
export function describeRpm(rpm: Rpm | null): string {
  if (rpm === null) return 'No RPM: no uploads in the last 30 days to estimate from';
  return `Works out to ${rpmDollars(rpm.low)}–${rpmDollars(rpm.high)} per 1,000 views (RPM)`;
}
