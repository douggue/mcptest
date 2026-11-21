import { describe, expect, test } from 'vitest';
import { hadReadingBy, videosAsOf } from '../src/changes/asOf';
import {
  CHANGES_BREAKOUTS_SHOWN,
  CHANGES_FORMAT_MIN_BREAKOUTS,
  mapChanges,
  type ChannelHistory,
} from '../src/changes/changes';
import { breakoutFormats } from '../src/changes/formats';
import type { StoredChannel, StoredVideo, VideoReading } from '../src/repos/types';

const NOW = new Date('2026-11-21T12:00:00Z');
const DAY_MS = 86_400_000;
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY_MS);
const SINCE = daysAgo(3);
const cid = (letter: string) => `UC${letter.repeat(22)}`;
const vid = (name: string) => name.padEnd(11, '_').slice(0, 11);

const channel = (letter: string, subscribers: number | null = 1000): StoredChannel => ({
  id: cid(letter),
  title: `Channel ${letter}`,
  handle: null,
  subscribers,
  subscribersHidden: subscribers === null,
  videoCount: null,
  fetchedAt: NOW,
});

const video = (
  channelLetter: string,
  name: string,
  views: number,
  publishedDays: number,
  title = `Title of ${name}`,
): StoredVideo => ({
  id: vid(name),
  channelId: cid(channelLetter),
  title,
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

/** Five ordinary videos of about a thousand views, read five days ago and today. */
const ordinary = (letter: string): readonly StoredVideo[] =>
  [1, 2, 3, 4, 5].map((n) => video(letter, `${letter}old${n}`, 1000, 30 + n));
const ordinaryReadings = (letter: string): readonly VideoReading[] =>
  [1, 2, 3, 4, 5].flatMap((n) => [
    reading(`${letter}old${n}`, 5, 1000, 30 + n),
    reading(`${letter}old${n}`, 0, 1000, 30 + n),
  ]);

const history = (
  letter: string,
  videos: readonly StoredVideo[],
  readings: readonly VideoReading[],
  subscribers: number | null = 1000,
): ChannelHistory => ({
  channel: channel(letter, subscribers),
  videos: [...ordinary(letter), ...videos],
  readings: [...ordinaryReadings(letter), ...readings],
});

describe('videosAsOf', () => {
  test('gives each video the views of its latest reading at or before the moment', () => {
    const then = videosAsOf(
      [video('a', 'one', 900, 20)],
      [reading('one', 6, 100), reading('one', 4, 300), reading('one', 1, 900)],
      SINCE,
    );

    expect(then.map((entry) => [entry.id, entry.views])).toEqual([[vid('one'), 300]]);
  });

  test('leaves out a video that had not been read by then', () => {
    const then = videosAsOf(
      [video('a', 'old', 500, 20), video('a', 'new', 800, 1)],
      [reading('old', 5, 400), reading('new', 0, 800)],
      SINCE,
    );

    expect(then.map((entry) => entry.id)).toEqual([vid('old')]);
  });

  test('says whether a channel had been read at all by then', () => {
    expect(hadReadingBy([reading('one', 5, 1)], SINCE)).toBe(true);
    expect(hadReadingBy([reading('one', 1, 1)], SINCE)).toBe(false);
    expect(hadReadingBy([], SINCE)).toBe(false);
  });
});

describe('mapChanges: new breakouts', () => {
  test('lists a video that is a breakout now and was not stored at the earlier reading', () => {
    const changes = mapChanges({
      lookalikes: [history('a', [video('a', 'fresh', 9000, 2)], [reading('fresh', 0, 9000, 2)])],
      since: SINCE,
      now: NOW,
    });

    expect(changes.newBreakoutCount).toBe(1);
    expect(changes.newBreakouts[0]).toMatchObject({
      videoId: vid('fresh'),
      channelId: cid('a'),
      views: 9000,
      was: 'not-stored',
      viewsThen: null,
    });
    expect(changes.newBreakouts[0]?.score).toBeGreaterThan(2);
  });

  test('lists a video that was stored then, below the breakout bar, and is above it now', () => {
    const changes = mapChanges({
      lookalikes: [
        history(
          'a',
          [video('a', 'grew', 8000, 10)],
          [reading('grew', 5, 1100, 10), reading('grew', 0, 8000, 10)],
        ),
      ],
      since: SINCE,
      now: NOW,
    });

    expect(
      changes.newBreakouts.map((entry) => [entry.videoId, entry.was, entry.viewsThen]),
    ).toEqual([[vid('grew'), 'below', 1100]]);
  });

  test('does not list a video that was already a breakout then', () => {
    const changes = mapChanges({
      lookalikes: [
        history(
          'a',
          [video('a', 'steady', 9000, 10)],
          [reading('steady', 5, 8500, 10), reading('steady', 0, 9000, 10)],
        ),
      ],
      since: SINCE,
      now: NOW,
    });

    expect(changes.newBreakouts).toEqual([]);
    expect(changes.newBreakoutCount).toBe(0);
  });

  test('does not call everything new on a channel that had no reading by then: it cannot be compared', () => {
    const unread: ChannelHistory = {
      channel: channel('b'),
      videos: [...ordinary('b'), video('b', 'big', 9000, 4)],
      readings: [
        ...ordinaryReadings('b').filter((entry) => entry.capturedAt.getTime() === NOW.getTime()),
        reading('big', 0, 9000, 4),
      ],
    };

    const changes = mapChanges({ lookalikes: [unread], since: SINCE, now: NOW });

    expect(changes.newBreakouts).toEqual([]);
    expect(changes.comparedChannels).toBe(0);
    expect(changes.uncomparedChannels).toBe(1);
  });

  test('shows the strongest first and says how many there are when more than it shows', () => {
    const many = Array.from({ length: CHANGES_BREAKOUTS_SHOWN + 3 }, (_, index) => index);
    const changes = mapChanges({
      lookalikes: many.map((index) => {
        const letter = String.fromCharCode(97 + index);
        const name = `${letter}hit`;
        return history(
          letter,
          [video(letter, name, 5000 + index * 1000, 2)],
          [reading(name, 0, 5000 + index * 1000, 2)],
        );
      }),
      since: SINCE,
      now: NOW,
    });

    expect(changes.newBreakoutCount).toBe(CHANGES_BREAKOUTS_SHOWN + 3);
    expect(changes.newBreakouts).toHaveLength(CHANGES_BREAKOUTS_SHOWN);
    const scores = changes.newBreakouts.map((entry) => entry.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });
});

describe('mapChanges: channel groups', () => {
  /** Three uploads widely seen, far above the channel's size: taken off now. */
  const hits = (letter: string): readonly StoredVideo[] =>
    [1, 2, 3].map((n) => video(letter, `${letter}hit${n}`, 60_000, 6 + n));

  test('lists a channel that has newly taken off, with what it was before', () => {
    const changes = mapChanges({
      lookalikes: [
        history(
          'a',
          hits('a'),
          [1, 2, 3].flatMap((n) => [
            reading(`ahit${n}`, 5, 2000, 6 + n),
            reading(`ahit${n}`, 0, 60_000, 6 + n),
          ]),
        ),
      ],
      since: SINCE,
      now: NOW,
    });

    expect(changes.groups.takenOff).toEqual([
      { channelId: cid('a'), title: 'Channel a', was: 'neither', now: 'taken-off' },
    ]);
    expect(changes.groups.rising).toEqual([]);
    expect(changes.groups.droppedOut).toEqual([]);
  });

  test('lists a channel that dropped out: it had taken off then and has not now', () => {
    // Its three hits were inside the ninety days then and have aged out of them since.
    const aged = [1, 2, 3].map((n) => video('a', `aage${n}`, 60_000, 90 + n / 10));
    const changes = mapChanges({
      lookalikes: [
        history(
          'a',
          aged,
          [1, 2, 3].flatMap((n) => [
            reading(`aage${n}`, 5, 60_000, 90 + n / 10),
            reading(`aage${n}`, 0, 60_000, 90 + n / 10),
          ]),
        ),
      ],
      since: SINCE,
      now: NOW,
    });

    expect(changes.groups.droppedOut).toEqual([
      { channelId: cid('a'), title: 'Channel a', was: 'taken-off', now: 'neither' },
    ]);
  });

  test('says nothing about a channel whose group is the same', () => {
    const changes = mapChanges({ lookalikes: [history('a', [], [])], since: SINCE, now: NOW });

    expect(changes.groups).toEqual({ takenOff: [], rising: [], droppedOut: [] });
  });
});

describe('breakoutFormats', () => {
  const titled = (name: string, title: string, channelLetter = 'a') => ({
    videoId: vid(name),
    title,
    channelId: cid(channelLetter),
    channelTitle: `Channel ${channelLetter}`,
    views: 1000,
  });

  test('finds a wording shared by several breakouts around a subject that changes', () => {
    const formats = breakoutFormats([
      titled('one', 'Why Lighthouses Quietly Disappeared From Every Coast'),
      titled('two', 'Why Windmills Quietly Disappeared From Every Coast', 'b'),
      titled('three', 'A Day In The Life Of A Clockmaker'),
    ]);

    expect(formats).toHaveLength(1);
    expect(formats[0]?.videos.map((entry) => entry.videoId).sort()).toEqual(
      [vid('one'), vid('two')].sort(),
    );
    expect(formats[0]?.template).toContain('{subject}');
    expect(CHANGES_FORMAT_MIN_BREAKOUTS).toBe(2);
  });

  test('finds none among titles that share no wording', () => {
    expect(
      breakoutFormats([
        titled('one', 'Why Lighthouses Quietly Disappeared From Every Coast'),
        titled('two', 'The Last Working Steam Tram In The Valley'),
      ]),
    ).toEqual([]);
  });

  test('lists one wording once, however many ways its subject can be blanked', () => {
    const formats = breakoutFormats([
      titled('one', 'The Forgotten Engine That Still Powers Remote Mountain Villages'),
      titled('two', 'The Forgotten Turbine That Still Powers Remote Mountain Villages'),
    ]);

    expect(formats).toHaveLength(1);
  });
});

describe('mapChanges: title formats', () => {
  test('lists a format seen in several breakouts now that was not among the breakouts then', () => {
    const changes = mapChanges({
      lookalikes: [
        history(
          'a',
          [video('a', 'one', 9000, 2, 'Why Lighthouses Quietly Disappeared From Every Coast')],
          [reading('one', 0, 9000, 2)],
        ),
        history(
          'b',
          [video('b', 'two', 9000, 2, 'Why Windmills Quietly Disappeared From Every Coast')],
          [reading('two', 0, 9000, 2)],
        ),
      ],
      since: SINCE,
      now: NOW,
    });

    expect(changes.formats).toHaveLength(1);
    expect(changes.formats[0]?.videos).toHaveLength(2);
  });

  test('does not list a format whose breakouts were all breakouts then', () => {
    const steady = (letter: string, name: string, title: string): ChannelHistory =>
      history(
        letter,
        [video(letter, name, 9000, 10, title)],
        [reading(name, 5, 8500, 10), reading(name, 0, 9000, 10)],
      );
    const changes = mapChanges({
      lookalikes: [
        steady('a', 'one', 'Why Lighthouses Quietly Disappeared From Every Coast'),
        steady('b', 'two', 'Why Windmills Quietly Disappeared From Every Coast'),
      ],
      since: SINCE,
      now: NOW,
    });

    expect(changes.formats).toEqual([]);
  });
});
