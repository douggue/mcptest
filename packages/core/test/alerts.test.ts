import { describe, expect, test } from 'vitest';
import {
  ALERT_MAX_MIN_SCORE,
  ALERT_MIN_MIN_SCORE,
  DEFAULT_ALERT_MIN_SCORE,
  findAlerts,
  isValidMinScore,
} from '../src/alerts/alerts';
import type { ChannelHistory } from '../src/changes/changes';
import type { StoredChannel, StoredVideo, VideoReading } from '../src/repos/types';

const NOW = new Date('2026-11-21T12:00:00Z');
const DAY_MS = 86_400_000;
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY_MS);
const SINCE = daysAgo(3);
const cid = (letter: string) => `UC${letter.repeat(22)}`;
const vid = (name: string) => name.padEnd(11, '_').slice(0, 11);

const channel = (letter: string): StoredChannel => ({
  id: cid(letter),
  title: `Channel ${letter}`,
  handle: null,
  subscribers: 1000,
  subscribersHidden: false,
  videoCount: null,
  fetchedAt: NOW,
});

const video = (
  letter: string,
  name: string,
  views: number,
  publishedDays: number,
): StoredVideo => ({
  id: vid(name),
  channelId: cid(letter),
  title: `Title of ${name}`,
  views,
  durationSeconds: 600,
  published: { date: daysAgo(publishedDays), precision: 'day', raw: `${publishedDays}d ago` },
  fetchedAt: NOW,
});

const reading = (name: string, days: number, views: number, publishedDays = 40): VideoReading => ({
  videoId: vid(name),
  capturedAt: daysAgo(days),
  views,
  publishedAt: daysAgo(publishedDays),
});

/** Five ordinary videos of a thousand views, read five days ago and today. */
const history = (
  letter: string,
  videos: readonly StoredVideo[],
  readings: readonly VideoReading[],
): ChannelHistory => ({
  channel: channel(letter),
  videos: [
    ...[1, 2, 3, 4, 5].map((n) => video(letter, `${letter}old${n}`, 1000, 30 + n)),
    ...videos,
  ],
  readings: [
    ...[1, 2, 3, 4, 5].flatMap((n) => [
      reading(`${letter}old${n}`, 5, 1000, 30 + n),
      reading(`${letter}old${n}`, 0, 1000, 30 + n),
    ]),
    ...readings,
  ],
});

const rule = (minScore: number, takenOff = true) => ({ minScore, takenOff });

describe('the alert rule', () => {
  test('has a stated default and a range the owner can choose in', () => {
    expect(DEFAULT_ALERT_MIN_SCORE).toBe(5);
    expect(isValidMinScore(DEFAULT_ALERT_MIN_SCORE)).toBe(true);
    expect(isValidMinScore(ALERT_MIN_MIN_SCORE)).toBe(true);
    expect(isValidMinScore(ALERT_MAX_MIN_SCORE)).toBe(true);
    expect(isValidMinScore(ALERT_MIN_MIN_SCORE - 0.1)).toBe(false);
    expect(isValidMinScore(ALERT_MAX_MIN_SCORE + 1)).toBe(false);
    expect(isValidMinScore(Number.NaN)).toBe(false);
  });
});

describe('findAlerts: videos past the owner number', () => {
  test('tells of a new video whose score passes the number', () => {
    const found = findAlerts({
      lookalikes: [history('a', [video('a', 'fresh', 9000, 2)], [reading('fresh', 0, 9000, 2)])],
      since: SINCE,
      now: NOW,
      rule: rule(5),
    });

    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      kind: 'breakout',
      subjectId: vid('fresh'),
      channelId: cid('a'),
      channelTitle: 'Channel a',
      videoTitle: 'Title of fresh',
      views: 9000,
    });
    expect(found[0]?.score).toBeGreaterThanOrEqual(5);
  });

  test('tells of a video that was a smaller breakout then and has now passed the number', () => {
    const found = findAlerts({
      lookalikes: [
        history(
          'a',
          [video('a', 'grew', 9000, 10)],
          [reading('grew', 5, 3000, 10), reading('grew', 0, 9000, 10)],
        ),
      ],
      since: SINCE,
      now: NOW,
      rule: rule(5),
    });

    expect(found.map((alert) => alert.subjectId)).toEqual([vid('grew')]);
  });

  test('says nothing of a video already past the number then, or under it now', () => {
    const found = findAlerts({
      lookalikes: [
        history(
          'a',
          [video('a', 'steady', 9000, 10), video('a', 'small', 3000, 4)],
          [reading('steady', 5, 8000, 10), reading('steady', 0, 9000, 10)],
        ),
      ],
      since: SINCE,
      now: NOW,
      rule: rule(5),
    });

    expect(found).toEqual([]);
  });

  test('says nothing of a channel that had no reading by then: it cannot be compared', () => {
    const unread: ChannelHistory = {
      channel: channel('b'),
      videos: [video('b', 'big', 90_000, 4)],
      readings: [reading('big', 0, 90_000, 4)],
    };

    expect(findAlerts({ lookalikes: [unread], since: SINCE, now: NOW, rule: rule(2) })).toEqual([]);
  });

  test('says nothing of an old video outside the breakout window', () => {
    const found = findAlerts({
      lookalikes: [
        history('a', [video('a', 'aged', 90_000, 60)], [reading('aged', 0, 90_000, 60)]),
      ],
      since: SINCE,
      now: NOW,
      rule: rule(2),
    });

    expect(found).toEqual([]);
  });
});

describe('findAlerts: channels that newly take off', () => {
  const hits = (letter: string) =>
    [1, 2, 3].map((n) => video(letter, `${letter}hit${n}`, 60_000, 6 + n));
  const grownReadings = (letter: string) =>
    [1, 2, 3].flatMap((n) => [
      reading(`${letter}hit${n}`, 5, 2000, 6 + n),
      reading(`${letter}hit${n}`, 0, 60_000, 6 + n),
    ]);

  test('tells of a channel that newly took off, once the rule asks for it', () => {
    const lookalikes = [history('a', hits('a'), grownReadings('a'))];

    const found = findAlerts({
      lookalikes,
      since: SINCE,
      now: NOW,
      rule: rule(ALERT_MAX_MIN_SCORE),
    });

    expect(found).toEqual([
      {
        kind: 'taken-off',
        subjectId: cid('a'),
        channelId: cid('a'),
        channelTitle: 'Channel a',
        videoTitle: null,
        score: null,
        views: null,
      },
    ]);
    expect(
      findAlerts({ lookalikes, since: SINCE, now: NOW, rule: rule(ALERT_MAX_MIN_SCORE, false) }),
    ).toEqual([]);
  });
});
