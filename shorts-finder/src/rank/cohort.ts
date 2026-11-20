/**
 * Where a video and its channel stand in a group of comparable videos: a
 * cohort. Pure arithmetic: given a cohort it returns positions (percentiles)
 * and nothing else. There are no thresholds here and no findings; what share
 * of a cohort counts as "outperforming" is set later, from real readings
 * across several unrelated niches. Nothing in this file knows any niche.
 *
 * A cohort is videos of the same age band. Within a band every video is
 * measured at the same mark of its growth summary (see `track/growth.ts`), so
 * a video is compared with others "at the same age", not with whatever each
 * happened to have when it was last read.
 */
import { GROWTH_MARK_HOURS, type GrowthMark, type GrowthSummary } from '../track/growth';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const HOURS_PER_DAY = 24;

export interface AgeBand {
  readonly name: string;
  /** From this age, included, to that age, not included, in hours. */
  readonly fromHours: number;
  readonly toHours: number;
  /** The growth figure the band's videos are compared at: the latest mark every one of them has passed. */
  readonly mark: GrowthMark;
}

/**
 * The five bands of a tracked video's life. They follow the growth marks: a
 * video joins a band when it passes that band's mark, so everything in a band
 * can be measured at it. The first band is measured at one hour; a video
 * younger than that has no figure yet and no position.
 */
export const AGE_BANDS: readonly AgeBand[] = [
  { name: '0-6 h', fromHours: 0, toHours: 6, mark: 'views1h' },
  { name: '6-24 h', fromHours: 6, toHours: 24, mark: 'views6h' },
  { name: '24-72 h', fromHours: 24, toHours: 72, mark: 'views24h' },
  { name: '3-7 d', fromHours: 72, toHours: 7 * HOURS_PER_DAY, mark: 'views72h' },
  { name: '7-14 d', fromHours: 7 * HOURS_PER_DAY, toHours: 14 * HOURS_PER_DAY, mark: 'views7d' },
];

/** The band an age falls in; null for an age before publication or past the last band. */
export function ageBandOf(ageHours: number): AgeBand | null {
  return AGE_BANDS.find((band) => ageHours >= band.fromHours && ageHours < band.toHours) ?? null;
}

/**
 * Each value's place among the known values, from 0 to 1: the share of them
 * below it, plus half the share equal to it (itself included). So the middle
 * of a group is 0.5, a lone value is 0.5, and ties share a place. A null
 * value has no place and is not counted among the others.
 */
export function percentileRanks(values: readonly (number | null)[]): readonly (number | null)[] {
  const known = values.filter((value) => value !== null).toSorted((a, b) => a - b);
  return values.map((value) => (value === null ? null : placeAmong(known, value)));
}

/** A value's place among sorted values, as `percentileRanks` defines it; null when there are none. */
export function placeAmong(sorted: readonly number[], value: number): number | null {
  if (sorted.length === 0) return null;
  const below = firstIndex(sorted, (entry) => entry >= value);
  const notAbove = firstIndex(sorted, (entry) => entry > value);
  return (below + (notAbove - below) / 2) / sorted.length;
}

/** The first index whose entry satisfies a test that, once true, stays true; the length when none does. */
function firstIndex(sorted: readonly number[], test: (entry: number) => boolean): number {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (test(sorted[middle] as number)) high = middle;
    else low = middle + 1;
  }
  return low;
}

export interface Distribution {
  readonly count: number;
  readonly min: number;
  readonly q1: number;
  readonly median: number;
  readonly q3: number;
  readonly max: number;
}

/** The value a share of the way through sorted values, on a straight line between neighbours. */
function quantile(sorted: readonly number[], share: number): number {
  const position = (sorted.length - 1) * share;
  const low = Math.floor(position);
  const high = Math.ceil(position);
  const a = sorted[low] as number;
  const b = sorted[high] as number;
  return a + (b - a) * (position - low);
}

/** The spread of some values: least, quartiles, most. Null for none. */
export function distribution(values: readonly number[]): Distribution | null {
  if (values.length === 0) return null;
  const sorted = values.toSorted((a, b) => a - b);
  return {
    count: sorted.length,
    min: sorted[0] as number,
    q1: quantile(sorted, 0.25),
    median: quantile(sorted, 0.5),
    q3: quantile(sorted, 0.75),
    max: sorted.at(-1) as number,
  };
}

/** One video of a cohort, with its growth summary and what is known of its channel. */
export interface CohortMember {
  readonly videoId: string;
  readonly channelId: string;
  readonly growth: GrowthSummary;
  /** Null when hidden or not read yet. */
  readonly subscribers: number | null;
  /** When the channel's account was made; null when not read yet. */
  readonly channelCreatedAt: Date | null;
}

export interface VideoStanding {
  readonly videoId: string;
  /** Views at the band's mark divided by the mark's hours; null when the mark is not filled. */
  readonly viewsPerHour: number | null;
  readonly speedPercentile: number | null;
  /**
   * Views at the mark for each subscriber, as a power of ten (2 means a
   * hundred views a subscriber). On that scale because the figure spans many
   * orders of magnitude. Null when the subscribers are hidden, unknown or none.
   */
  readonly viewsPerSubscriberLog10: number | null;
  readonly viewsPerSubscriberPercentile: number | null;
}

export interface ChannelStanding {
  readonly channelId: string;
  readonly subscribers: number | null;
  /** Higher means more subscribers than more of the cohort's channels. */
  readonly subscribersPercentile: number | null;
  readonly accountAgeDays: number | null;
  /** Higher means an older account than more of the cohort's channels. */
  readonly accountAgePercentile: number | null;
}

export interface CohortStatistics {
  /** In the order the members were given. */
  readonly videos: readonly VideoStanding[];
  /** Each channel once, in the order first met. */
  readonly channels: readonly ChannelStanding[];
}

const perSubscriberLog10 = (views: number | null, subscribers: number | null): number | null =>
  views === null || subscribers === null || subscribers <= 0 || views <= 0
    ? null
    : Math.log10(views / subscribers);

function channelStandings(members: readonly CohortMember[], now: Date): readonly ChannelStanding[] {
  const channels = [...new Map(members.map((member) => [member.channelId, member])).values()];
  const ages = channels.map((channel) =>
    channel.channelCreatedAt === null
      ? null
      : (now.getTime() - channel.channelCreatedAt.getTime()) / MS_PER_DAY,
  );
  const bySize = percentileRanks(channels.map((channel) => channel.subscribers));
  const byAge = percentileRanks(ages);
  return channels.map((channel, index) => ({
    channelId: channel.channelId,
    subscribers: channel.subscribers,
    subscribersPercentile: bySize[index] ?? null,
    accountAgeDays: ages[index] ?? null,
    accountAgePercentile: byAge[index] ?? null,
  }));
}

/**
 * Where each video of a cohort stands by views per hour at the band's mark
 * and by views per subscriber there, and where each of its channels stands by
 * subscribers and by the age of its account. `now` is what account ages are
 * counted to.
 */
export function cohortStatistics(
  members: readonly CohortMember[],
  band: AgeBand,
  now: Date,
): CohortStatistics {
  const hours = GROWTH_MARK_HOURS[band.mark];
  const views = members.map((member) => member.growth[band.mark]);
  const speeds = views.map((count) => (count === null ? null : count / hours));
  const ratios = members.map((member, index) =>
    perSubscriberLog10(views[index] ?? null, member.subscribers),
  );
  const bySpeed = percentileRanks(speeds);
  const byRatio = percentileRanks(ratios);
  return {
    videos: members.map((member, index) => ({
      videoId: member.videoId,
      viewsPerHour: speeds[index] ?? null,
      speedPercentile: bySpeed[index] ?? null,
      viewsPerSubscriberLog10: ratios[index] ?? null,
      viewsPerSubscriberPercentile: byRatio[index] ?? null,
    })),
    channels: channelStandings(members, now),
  };
}
