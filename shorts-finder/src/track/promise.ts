/**
 * A tracked video's place in its group, which decides how often it is read.
 *
 * The group (cohort) is the tracked videos of the same subject keyword and
 * country in the same age band. When that holds too few to rank among, it
 * widens: first to the country across all subjects, then to everything in
 * the band. A place among three videos says nothing; a place among every
 * video of that age still says whether this one is fast or slow for its age.
 */
import { ageBandOf, placeAmong } from '../rank/cohort';
import type { ActiveVideo } from '../repos/types';
import type { Position } from './tiers';
import { NO_POSITION } from './tiers';
import { velocity, type ViewReading } from './velocity';

const MS_PER_HOUR = 60 * 60 * 1000;
/**
 * A group of fewer than ten is widened. Below ten, one video is a tenth of
 * the group or more and "the upper half" turns on a handful of rivals.
 * A starting value, to be revisited when real cohort sizes are known
 * (`npm run report` prints them).
 */
export const COHORT_MIN_MEMBERS = 10;

/** What ranks a video: its subject, its age, its speed and its channel's size. */
export interface Ranked {
  readonly videoId: string;
  readonly channelId: string;
  readonly keyword: string | null;
  readonly region: string | null;
  readonly publishedAt: Date;
  /** Views per hour; null when not known. */
  readonly rate: number | null;
  readonly subscribers: number | null;
}

/** How far a video's group had to be widened to hold enough to rank among. */
export type CohortLevel = 'subject' | 'region' | 'band';

export interface Placed extends Position {
  /** Null for a video outside every age band (older than tracking lasts). */
  readonly level: CohortLevel | null;
  readonly cohortSize: number;
}

export interface Cohorts {
  /** Where the video stands; `rate` replaces its own when a newer one has just been read. */
  positionOf(video: Ranked, rate?: number | null): Placed;
}

interface Group {
  size: number;
  rates: number[];
  /** One entry for each channel of the group with a known subscriber count. */
  sizes: number[];
  readonly channels: Set<string>;
}

interface Keys {
  readonly subject: string | null;
  readonly region: string | null;
  readonly band: string;
}

/** The names of the three groups a video belongs to, narrowest first; null outside every band. */
function keysOf(video: Ranked, now: Date): Keys | null {
  const band = ageBandOf((now.getTime() - video.publishedAt.getTime()) / MS_PER_HOUR);
  if (band === null) return null;
  const region = video.region === null ? null : `${band.name}|${video.region}`;
  const subject = region === null || video.keyword === null ? null : `${region}|${video.keyword}`;
  return { subject, region, band: band.name };
}

function addTo(groups: Map<string, Group>, key: string | null, video: Ranked): void {
  if (key === null) return;
  const group = groups.get(key) ?? { size: 0, rates: [], sizes: [], channels: new Set() };
  group.size += 1;
  if (video.rate !== null) group.rates.push(video.rate);
  if (video.subscribers !== null && !group.channels.has(video.channelId)) {
    group.sizes.push(video.subscribers);
  }
  group.channels.add(video.channelId);
  groups.set(key, group);
}

const ascending = (a: number, b: number): number => a - b;

/**
 * Sorts every tracked video into its groups once, so that each video's place
 * can then be looked up quickly. The groups are built here, inside one call,
 * and are not changed after it returns.
 */
export function buildCohorts(videos: readonly Ranked[], now: Date): Cohorts {
  const groups = new Map<string, Group>();
  for (const video of videos) {
    const keys = keysOf(video, now);
    if (keys === null) continue;
    [keys.subject, keys.region, keys.band].forEach((key) => addTo(groups, key, video));
  }
  for (const group of groups.values()) {
    group.rates.sort(ascending);
    group.sizes.sort(ascending);
  }
  const pick = (keys: Keys): { level: CohortLevel; group: Group | undefined } => {
    const subject = keys.subject === null ? undefined : groups.get(keys.subject);
    if (subject !== undefined && subject.size >= COHORT_MIN_MEMBERS) {
      return { level: 'subject', group: subject };
    }
    const region = keys.region === null ? undefined : groups.get(keys.region);
    if (region !== undefined && region.size >= COHORT_MIN_MEMBERS) {
      return { level: 'region', group: region };
    }
    return { level: 'band', group: groups.get(keys.band) };
  };
  return {
    positionOf(video, rate = video.rate) {
      const keys = keysOf(video, now);
      if (keys === null) return { ...NO_POSITION, level: null, cohortSize: 0 };
      const { level, group } = pick(keys);
      return {
        speedPercentile: rate === null ? null : placeAmong(group?.rates ?? [], rate),
        channelSizePercentile:
          video.subscribers === null ? null : placeAmong(group?.sizes ?? [], video.subscribers),
        level,
        cohortSize: group?.size ?? 0,
      };
    },
  };
}

/**
 * The views per hour a video is ranked by: its rate over its latest readings
 * when that is known and not stale, otherwise its average since publication,
 * which every video with a visible count has from its first reading. Null
 * when the count is hidden.
 */
export function promiseRate(
  readings: readonly ViewReading[],
  publishedAt: Date,
  now: Date,
  views: number | null,
): number | null {
  const measured = velocity(readings, now);
  if (measured.viewsPerHour !== null && !measured.stale) return measured.viewsPerHour;
  const ageHours = (now.getTime() - publishedAt.getTime()) / MS_PER_HOUR;
  return views === null || ageHours <= 0 ? null : views / ageHours;
}

/** A tracked video as the groups see it at `now`, ranked by its last rate or its average so far. */
export const rankedAt = (video: ActiveVideo, now: Date): Ranked => ({
  videoId: video.videoId,
  channelId: video.channelId,
  keyword: video.keyword,
  region: video.region,
  publishedAt: video.publishedAt,
  rate: video.rate ?? promiseRate([], video.publishedAt, now, video.views),
  subscribers: video.subscribers,
});
