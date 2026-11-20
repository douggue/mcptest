import { describe, expect, test } from 'vitest';
import {
  AGE_BANDS,
  ageBandOf,
  cohortStatistics,
  distribution,
  percentileRanks,
  placeAmong,
  type CohortMember,
} from '../src/rank/cohort';
import { NO_GROWTH } from '../src/track/growth';
import { channelId, videoId } from './fixtures/apiReplies';
import { DAY_MS, NOW, at } from './fixtures/facts';

describe('ageBandOf', () => {
  test('puts an age in one of five bands, each measured at the mark it has passed', () => {
    expect(AGE_BANDS.map((band) => [band.name, band.mark])).toEqual([
      ['0-6 h', 'views1h'],
      ['6-24 h', 'views6h'],
      ['24-72 h', 'views24h'],
      ['3-7 d', 'views72h'],
      ['7-14 d', 'views7d'],
    ]);
  });

  test.each([
    [0, '0-6 h'],
    [5.99, '0-6 h'],
    [6, '6-24 h'],
    [24, '24-72 h'],
    [71.9, '24-72 h'],
    [72, '3-7 d'],
    [168, '7-14 d'],
    [335.9, '7-14 d'],
  ])('puts an age of %s hours in the band %s', (hours, name) => {
    expect(ageBandOf(hours)?.name).toBe(name);
  });

  test('has no band for an age before publication or past fourteen days', () => {
    expect(ageBandOf(-1)).toBeNull();
    expect(ageBandOf(336)).toBeNull();
  });
});

describe('percentileRanks', () => {
  test('places each value by the share below it plus half the share equal to it', () => {
    expect(percentileRanks([10, 20, 30, 40])).toEqual([0.125, 0.375, 0.625, 0.875]);
    expect(percentileRanks([40, 10, 30, 20])).toEqual([0.875, 0.125, 0.625, 0.375]);
  });

  test('gives ties the same place, and a lone value the middle', () => {
    expect(percentileRanks([5, 5, 5, 5])).toEqual([0.5, 0.5, 0.5, 0.5]);
    expect(percentileRanks([1, 7, 7, 9])).toEqual([0.125, 0.5, 0.5, 0.875]);
    expect(percentileRanks([123])).toEqual([0.5]);
  });

  test('gives a missing value no place and does not count it among the others', () => {
    expect(percentileRanks([null, 10, null, 30])).toEqual([null, 0.25, null, 0.75]);
    expect(percentileRanks([null, null])).toEqual([null, null]);
    expect(percentileRanks([])).toEqual([]);
  });

  test('does not depend on the size of the numbers, only on their order', () => {
    const small = percentileRanks([1, 2, 3]);
    const large = percentileRanks([1_000, 2_000_000, 3_000_000_000]);

    expect(large).toEqual(small);
  });
});

describe('placeAmong', () => {
  test('places a value that is not in the group as it would stand there', () => {
    const sorted = [10, 20, 30, 40];

    expect(placeAmong(sorted, 5)).toBe(0);
    expect(placeAmong(sorted, 25)).toBe(0.5);
    expect(placeAmong(sorted, 99)).toBe(1);
    expect(placeAmong([], 5)).toBeNull();
  });
});

describe('distribution', () => {
  test('gives the least, the quartiles and the most', () => {
    expect(distribution([40, 10, 30, 20, 50])).toEqual({
      count: 5,
      min: 10,
      q1: 20,
      median: 30,
      q3: 40,
      max: 50,
    });
  });

  test('draws a quartile between two neighbours when it falls between them', () => {
    expect(distribution([10, 20, 30, 40])).toMatchObject({ q1: 17.5, median: 25, q3: 32.5 });
    expect(distribution([7])).toEqual({ count: 1, min: 7, q1: 7, median: 7, q3: 7, max: 7 });
  });

  test('has nothing to say of no values', () => {
    expect(distribution([])).toBeNull();
  });
});

describe('cohortStatistics', () => {
  const BAND = AGE_BANDS[2]!;
  const member = (
    n: number,
    letter: string,
    views24h: number | null,
    subscribers: number | null,
    accountAgeDays: number | null = 400,
  ): CohortMember => ({
    videoId: videoId(n),
    channelId: channelId(letter),
    growth: { ...NO_GROWTH, views24h },
    subscribers,
    channelCreatedAt: accountAgeDays === null ? null : at(-accountAgeDays * DAY_MS),
  });

  test('places each video by its views per hour at the band’s mark', () => {
    const cohort = [
      member(1, 'A', 2400, 100),
      member(2, 'B', 240, 100),
      member(3, 'C', 24_000, 100),
      member(4, 'D', 4800, 100),
    ];

    const { videos } = cohortStatistics(cohort, BAND, NOW);

    expect(videos.map((video) => video.viewsPerHour)).toEqual([100, 10, 1000, 200]);
    expect(videos.map((video) => video.speedPercentile)).toEqual([0.375, 0.125, 0.875, 0.625]);
    expect(videos.map((video) => video.videoId)).toEqual(cohort.map((entry) => entry.videoId));
  });

  test('places each video by its views per subscriber, on a scale of powers of ten', () => {
    const cohort = [
      member(1, 'A', 10_000, 100),
      member(2, 'B', 10_000, 100_000),
      member(3, 'C', 10_000, 10_000),
    ];

    const { videos } = cohortStatistics(cohort, BAND, NOW);

    expect(videos.map((video) => video.viewsPerSubscriberLog10)).toEqual([2, -1, 0]);
    expect(videos[0]?.viewsPerSubscriberPercentile).toBeCloseTo(5 / 6, 10);
    expect(videos[1]?.viewsPerSubscriberPercentile).toBeCloseTo(1 / 6, 10);
    expect(videos[2]?.viewsPerSubscriberPercentile).toBe(0.5);
  });

  test('has no views-per-subscriber figure when the subscribers are hidden or none, or the views unknown or none', () => {
    const cohort = [
      member(1, 'A', 5000, null),
      member(2, 'B', 5000, 0),
      member(3, 'C', null, 500),
      member(4, 'D', 0, 500),
      member(5, 'E', 5000, 50),
    ];

    const { videos } = cohortStatistics(cohort, BAND, NOW);

    expect(videos.map((video) => video.viewsPerSubscriberLog10)).toEqual([
      null,
      null,
      null,
      null,
      2,
    ]);
    expect(videos.map((video) => video.viewsPerSubscriberPercentile)).toEqual([
      null,
      null,
      null,
      null,
      0.5,
    ]);
    // A video with no figure at the mark has no speed either, and does not weigh on the others.
    expect(videos[2]).toMatchObject({ viewsPerHour: null, speedPercentile: null });
    expect(videos[3]).toMatchObject({ viewsPerHour: 0, speedPercentile: 0.125 });
  });

  test('places each channel once, by its subscribers and by the age of its account', () => {
    const cohort = [
      member(1, 'A', 100, 500, 30),
      member(2, 'A', 900, 500, 30),
      member(3, 'B', 100, 80_000, 2000),
      member(4, 'C', 100, null, null),
      member(5, 'D', 100, 2000, 400),
    ];

    const { channels } = cohortStatistics(cohort, BAND, NOW);

    expect(channels.map((channel) => channel.channelId)).toEqual(
      ['A', 'B', 'C', 'D'].map(channelId),
    );
    expect(channels.map((channel) => channel.subscribersPercentile)).toEqual([
      1 / 6,
      5 / 6,
      null,
      0.5,
    ]);
    expect(channels.map((channel) => channel.accountAgeDays)).toEqual([30, 2000, null, 400]);
    expect(channels.map((channel) => channel.accountAgePercentile)).toEqual([
      1 / 6,
      5 / 6,
      null,
      0.5,
    ]);
  });

  test('measures another band at its own mark', () => {
    const first = AGE_BANDS[0]!;
    const young: CohortMember = {
      ...member(1, 'A', null, 10),
      growth: { ...NO_GROWTH, views1h: 300 },
    };

    expect(cohortStatistics([young], first, NOW).videos[0]).toMatchObject({
      viewsPerHour: 300,
      speedPercentile: 0.5,
    });
  });

  test('has nothing to place in an empty cohort', () => {
    expect(cohortStatistics([], BAND, NOW)).toEqual({ videos: [], channels: [] });
  });
});
