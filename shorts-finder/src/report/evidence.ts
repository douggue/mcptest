/**
 * What a real run has gathered, laid out for the owner to read: for each
 * subject and country, how many videos its searches found, how they spread
 * over the age bands, and how their views at 24 hours and their views per
 * subscriber at 24 hours are distributed; and how much the same keyword's
 * results overlap between countries.
 *
 * It decides nothing. The cut-offs for what counts as outperforming are to be
 * chosen from figures like these, across several unrelated subjects, by a
 * later step. Nothing here is a threshold.
 */
import { compactNumber, wholeNumber } from '../alerts/text';
import { AGE_BANDS, ageBandOf, distribution, type Distribution } from '../rank/cohort';

const MS_PER_HOUR = 60 * 60 * 1000;
const PERCENT = 100;
/** What the videos past the last age band are listed under. */
const PAST_BANDS = 'older';

/** A video one of a subject's searches found, with what the report measures. */
export interface SubjectVideo {
  readonly keyword: string;
  readonly region: string;
  readonly videoId: string;
  readonly publishedAt: Date;
  /** Its views at 24 hours from its growth summary; null when that mark was not bracketed. */
  readonly views24h: number | null;
  /** Its channel's subscribers; null when hidden or not read. */
  readonly subscribers: number | null;
}

export interface BandCount {
  readonly band: string;
  readonly count: number;
}

export interface SubjectEvidence {
  readonly keyword: string;
  readonly region: string;
  /** Videos this subject's searches have found and that are still stored. */
  readonly videos: number;
  /** How those spread over the age bands today: the sizes of the subject's own cohorts. */
  readonly bands: readonly BandCount[];
  readonly views24h: Distribution | null;
  /** Views at 24 hours for each subscriber, over the videos whose channel shows a count above none. */
  readonly views24hPerSubscriber: Distribution | null;
}

export interface RegionOverlap {
  readonly keyword: string;
  readonly regions: readonly [string, string];
  readonly found: readonly [number, number];
  /** Videos both countries' searches found. */
  readonly shared: number;
  /** The shared videos as a share of the smaller of the two sets; null when either is empty. */
  readonly share: number | null;
}

export interface Evidence {
  readonly subjects: readonly SubjectEvidence[];
  readonly overlaps: readonly RegionOverlap[];
}

const known = (values: readonly (number | null)[]): readonly number[] =>
  values.filter((value) => value !== null);

function bandCounts(videos: readonly SubjectVideo[], now: Date): readonly BandCount[] {
  const names = videos.map(
    (video) =>
      ageBandOf((now.getTime() - video.publishedAt.getTime()) / MS_PER_HOUR)?.name ?? PAST_BANDS,
  );
  return [...AGE_BANDS.map((band) => band.name), PAST_BANDS].map((band) => ({
    band,
    count: names.filter((name) => name === band).length,
  }));
}

function subjectEvidence(videos: readonly SubjectVideo[], now: Date): SubjectEvidence {
  const first = videos[0] as SubjectVideo;
  const perSubscriber = videos.map((video) =>
    video.views24h === null || video.subscribers === null || video.subscribers <= 0
      ? null
      : video.views24h / video.subscribers,
  );
  return {
    keyword: first.keyword,
    region: first.region,
    videos: videos.length,
    bands: bandCounts(videos, now),
    views24h: distribution(known(videos.map((video) => video.views24h))),
    views24hPerSubscriber: distribution(known(perSubscriber)),
  };
}

function overlapsOf(
  keyword: string,
  byRegion: ReadonlyMap<string, ReadonlySet<string>>,
): RegionOverlap[] {
  const regions = [...byRegion.keys()].toSorted();
  return regions.flatMap((a, index) =>
    regions.slice(index + 1).map((b): RegionOverlap => {
      const inA = byRegion.get(a) ?? new Set<string>();
      const inB = byRegion.get(b) ?? new Set<string>();
      const shared = [...inA].filter((id) => inB.has(id)).length;
      const smaller = Math.min(inA.size, inB.size);
      return {
        keyword,
        regions: [a, b],
        found: [inA.size, inB.size],
        shared,
        share: smaller === 0 ? null : shared / smaller,
      };
    }),
  );
}

/** Groups rows by a key, keeping the order in which each key was first met. */
function groupBy<T>(
  rows: readonly T[],
  keyOf: (row: T) => string,
): ReadonlyMap<string, readonly T[]> {
  return rows.reduce(
    (groups, row) => groups.set(keyOf(row), [...(groups.get(keyOf(row)) ?? []), row]),
    new Map<string, readonly T[]>(),
  );
}

/** Lays out what the searches have found, by subject and country, as of `now`. */
export function buildEvidence(rows: readonly SubjectVideo[], now: Date): Evidence {
  const bySubject = groupBy(rows, (row) => `${row.keyword}\u0000${row.region}`);
  const byKeyword = groupBy(rows, (row) => row.keyword);
  return {
    subjects: [...bySubject.values()].map((videos) => subjectEvidence(videos, now)),
    overlaps: [...byKeyword].flatMap(([keyword, videos]) => {
      const byRegion = new Map(
        [...groupBy(videos, (video) => video.region)].map(([region, found]) => [
          region,
          new Set(found.map((video) => video.videoId)),
        ]),
      );
      return overlapsOf(keyword, byRegion);
    }),
  };
}

const spread = (values: Distribution | null, show: (value: number) => string): string =>
  values === null
    ? 'no figures yet'
    : `min ${show(values.min)}, quartiles ${show(values.q1)} / ${show(values.median)} / ` +
      `${show(values.q3)}, max ${show(values.max)} (${wholeNumber(values.count)} videos)`;

/** A ratio to two places: views per subscriber is often well under one. */
const ratio = (value: number): string => value.toFixed(2);

function subjectLines(subject: SubjectEvidence): readonly string[] {
  const bands = subject.bands
    .filter((entry) => entry.count > 0)
    .map((entry) => `${entry.band}: ${wholeNumber(entry.count)}`)
    .join(', ');
  return [
    `"${subject.keyword}" in ${subject.region}: ${wholeNumber(subject.videos)} videos found`,
    `  by age now: ${bands === '' ? 'none' : bands}`,
    `  views at 24 h: ${spread(subject.views24h, compactNumber)}`,
    `  views at 24 h per subscriber: ${spread(subject.views24hPerSubscriber, ratio)}`,
  ];
}

function overlapLine(overlap: RegionOverlap): string {
  const [a, b] = overlap.regions;
  const [inA, inB] = overlap.found;
  const share =
    overlap.share === null
      ? 'nothing to compare'
      : `${Math.round(overlap.share * PERCENT)}% of the smaller`;
  return (
    `"${overlap.keyword}" ${a} and ${b}: ${wholeNumber(overlap.shared)} shared ` +
    `of ${wholeNumber(inA)} and ${wholeNumber(inB)} (${share})`
  );
}

/** The report as lines of plain text. */
export function formatEvidence(evidence: Evidence): readonly string[] {
  if (evidence.subjects.length === 0) {
    return ['Nothing has been found yet. Run the service for a while, then ask again.'];
  }
  return [
    'What the searches have found, by subject and country',
    ...evidence.subjects.flatMap(subjectLines),
    '',
    'How much each keyword overlaps between countries',
    ...(evidence.overlaps.length === 0
      ? ['No keyword is searched in more than one country.']
      : evidence.overlaps.map(overlapLine)),
  ];
}
