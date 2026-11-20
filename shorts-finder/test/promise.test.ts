import { describe, expect, test } from 'vitest';
import { COHORT_MIN_MEMBERS, buildCohorts, promiseRate, type Ranked } from '../src/track/promise';
import type { ViewReading } from '../src/track/velocity';
import { channelId, videoId } from './fixtures/apiReplies';
import { DAY_MS, HOUR_MS, NOW, at } from './fixtures/facts';

/** Unrelated subjects in more than one country; nothing here leans towards any of them. */
const SUBJECTS = [
  { keyword: 'paper folding', region: 'US' },
  { keyword: 'sourdough starter', region: 'US' },
  { keyword: 'night sky', region: 'GB' },
  { keyword: 'bicycle repair', region: 'CA' },
] as const;

let next = 0;

/** A tracked video ten hours old (in the 6-24 hour band) unless told otherwise. */
function video(
  subject: { keyword: string | null; region: string | null },
  rate: number | null,
  overrides: Partial<Ranked> = {},
): Ranked {
  next += 1;
  return {
    videoId: videoId(next),
    channelId: channelId(String.fromCharCode(65 + (next % 26))),
    keyword: subject.keyword,
    region: subject.region,
    publishedAt: at(-10 * HOUR_MS),
    rate,
    subscribers: 1000,
    ...overrides,
  };
}

const many = (
  count: number,
  subject: { keyword: string | null; region: string | null },
  rateOf: (index: number) => number,
): Ranked[] => Array.from({ length: count }, (_, index) => video(subject, rateOf(index)));

describe('buildCohorts', () => {
  test('ranks a video among those of its own subject, country and age band when there are enough', () => {
    const paper = many(COHORT_MIN_MEMBERS, SUBJECTS[0], (index) => (index + 1) * 10);
    const bread = many(COHORT_MIN_MEMBERS, SUBJECTS[1], (index) => (index + 1) * 10_000);
    const cohorts = buildCohorts([...paper, ...bread], NOW);

    const slowest = cohorts.positionOf(paper[0]!);
    const fastest = cohorts.positionOf(paper[9]!);

    // The other subject's far larger numbers do not weigh on these.
    expect(slowest).toMatchObject({ level: 'subject', cohortSize: 10, speedPercentile: 0.05 });
    expect(fastest).toMatchObject({ level: 'subject', speedPercentile: 0.95 });
    expect(COHORT_MIN_MEMBERS).toBe(10);
  });

  test('widens to the country across all subjects when the subject’s own group is too small', () => {
    const paper = many(4, SUBJECTS[0], () => 100);
    const bread = many(8, SUBJECTS[1], () => 50);
    const elsewhere = many(12, SUBJECTS[2], () => 1);
    const cohorts = buildCohorts([...paper, ...bread, ...elsewhere], NOW);

    const placed = cohorts.positionOf(paper[0]!);

    expect(placed).toMatchObject({ level: 'region', cohortSize: 12 });
    // Above the eight slower videos of its country, level with its own three.
    expect(placed.speedPercentile).toBeCloseTo((8 + 2) / 12, 10);
  });

  test('widens to everything in the age band when the country is too small as well', () => {
    const few = [...many(2, SUBJECTS[0], () => 5), ...many(3, SUBJECTS[2], () => 50)];
    const cohorts = buildCohorts(few, NOW);

    expect(cohorts.positionOf(few[0]!)).toMatchObject({
      level: 'band',
      cohortSize: 5,
      speedPercentile: 0.2,
    });
  });

  test('ranks a video no subject led to among everything in its band', () => {
    const others = many(12, SUBJECTS[3], (index) => index);
    const orphan = video({ keyword: null, region: null }, 100);
    const cohorts = buildCohorts([...others, orphan], NOW);

    expect(cohorts.positionOf(orphan)).toMatchObject({ level: 'band', cohortSize: 13 });
  });

  test('keeps the age bands apart: a video is ranked among those of its own age', () => {
    const young = many(COHORT_MIN_MEMBERS, SUBJECTS[0], () => 1000).map((entry) => ({
      ...entry,
      publishedAt: at(-2 * HOUR_MS),
    }));
    const older = many(COHORT_MIN_MEMBERS, SUBJECTS[0], (index) => index + 1);
    const cohorts = buildCohorts([...young, ...older], NOW);

    expect(cohorts.positionOf(older[9]!)).toMatchObject({ cohortSize: 10, speedPercentile: 0.95 });
  });

  test('places a channel among the channels of the group, each counted once', () => {
    const big = { channelId: channelId('Z'), subscribers: 5_000_000 };
    const group = [
      ...many(9, SUBJECTS[0], () => 10).map((entry, index) => ({
        ...entry,
        channelId: `UC${String(index).padStart(22, 'q')}`,
        subscribers: (index + 1) * 100,
      })),
      video(SUBJECTS[0], 10, big),
      video(SUBJECTS[0], 10, big),
      video(SUBJECTS[0], 10, big),
    ];
    const cohorts = buildCohorts(group, NOW);

    // Ten channels: the large one is above nine, however many videos it has here.
    expect(cohorts.positionOf(group[9]!).channelSizePercentile).toBe(0.95);
    expect(cohorts.positionOf(group[0]!).channelSizePercentile).toBe(0.05);
  });

  test('has no place for what is not known: a hidden count, a hidden channel size, an age past tracking', () => {
    const group = many(COHORT_MIN_MEMBERS, SUBJECTS[0], (index) => index);
    const hidden = video(SUBJECTS[0], null, { subscribers: null });
    const old = video(SUBJECTS[0], 5, { publishedAt: at(-15 * DAY_MS) });
    const cohorts = buildCohorts([...group, hidden, old], NOW);

    expect(cohorts.positionOf(hidden)).toMatchObject({
      speedPercentile: null,
      channelSizePercentile: null,
      cohortSize: 11,
    });
    expect(cohorts.positionOf(old)).toEqual({
      speedPercentile: null,
      channelSizePercentile: null,
      level: null,
      cohortSize: 0,
    });
  });

  test('places a video by a newer rate than the one it was built with, when given one', () => {
    const group = many(COHORT_MIN_MEMBERS, SUBJECTS[0], (index) => (index + 1) * 10);
    const cohorts = buildCohorts(group, NOW);

    expect(cohorts.positionOf(group[0]!, 1000).speedPercentile).toBe(1);
    expect(cohorts.positionOf(group[0]!, null).speedPercentile).toBeNull();
  });

  test('has nothing to rank among in an empty store', () => {
    const alone = video(SUBJECTS[0], 5);

    expect(buildCohorts([], NOW).positionOf(alone)).toMatchObject({
      speedPercentile: null,
      level: 'band',
      cohortSize: 0,
    });
  });
});

describe('promiseRate', () => {
  const PUBLISHED = at(-10 * HOUR_MS);
  const readings = (...points: ReadonlyArray<readonly [hoursAgo: number, views: number]>) =>
    points.map(([hoursAgo, views]): ViewReading => ({
      capturedAt: at(-hoursAgo * HOUR_MS),
      views,
    }));

  test('is the rate over the latest readings when there is one', () => {
    expect(promiseRate(readings([2, 1000], [0, 1600]), PUBLISHED, NOW, 1600)).toBe(300);
  });

  test('is the average since publication for a video with one reading, or readings gone stale', () => {
    expect(promiseRate(readings([0, 500]), PUBLISHED, NOW, 500)).toBe(50);
    expect(promiseRate(readings([9, 100], [8, 4000]), PUBLISHED, NOW, 5000)).toBe(500);
  });

  test('is unknown for a hidden count, or a video not yet published by the clock', () => {
    expect(promiseRate([], PUBLISHED, NOW, null)).toBeNull();
    expect(promiseRate([], at(HOUR_MS), NOW, 10)).toBeNull();
  });
});
