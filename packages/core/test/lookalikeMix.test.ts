import { describe, expect, test } from 'vitest';
import {
  MIX_TAKEN_OFF_PERCENT,
  TAKEN_OFF_MIN_VIDEOS,
  TAKEN_OFF_MIN_VIDEO_VIEWS,
  TAKEN_OFF_MIN_VIEWS_PER_SUBSCRIBER,
  TAKEN_OFF_MIN_WINDOW_VIEWS,
  TAKEN_OFF_WINDOW_DAYS,
  channelGroup,
  mixOrder,
  mixSplit,
  type ChannelGroup,
  type GroupEvidence,
} from '../src/map/mix';
import { buildMapView, channelMetrics, type MapMemberData } from '../src/map/view';
import { NICHE_LONG_WINDOW_DAYS } from '../src/niches/niches';
import { NICHE_MIN_VIDEO_VIEWS } from '../src/niches/outperform';
import type { StoredChannel, StoredVideo } from '../src/repos/types';

const NOW = new Date('2026-11-20T12:00:00Z');
const DAY_MS = 86_400_000;
const cid = (letter: string) => `UC${letter.repeat(22)}`;

const evidence = (overrides: Partial<GroupEvidence> = {}): GroupEvidence => ({
  rising: false,
  windowViews: 400_000,
  widelySeenUploads: 5,
  subscribers: 20_000,
  ...overrides,
});

describe('the two groups', () => {
  test('are drawn with numbers that belong to no niche', () => {
    expect([
      MIX_TAKEN_OFF_PERCENT,
      TAKEN_OFF_WINDOW_DAYS,
      TAKEN_OFF_MIN_VIDEOS,
      TAKEN_OFF_MIN_VIDEO_VIEWS,
      TAKEN_OFF_MIN_WINDOW_VIEWS,
      TAKEN_OFF_MIN_VIEWS_PER_SUBSCRIBER,
    ]).toEqual([70, 90, 3, 10_000, 100_000, 1]);
  });

  test('use the window and the view floor the niche list already uses', () => {
    expect(TAKEN_OFF_WINDOW_DAYS).toBe(NICHE_LONG_WINDOW_DAYS);
    expect(TAKEN_OFF_MIN_VIDEO_VIEWS).toBe(NICHE_MIN_VIDEO_VIEWS);
  });

  test('call a channel taken off when its uploads are widely seen again and again', () => {
    expect(channelGroup(evidence())).toBe('taken-off');
  });

  test('need a pattern: two widely seen uploads are not one', () => {
    expect(channelGroup(evidence({ widelySeenUploads: 2 }))).toBe('neither');
    expect(channelGroup(evidence({ widelySeenUploads: 3 }))).toBe('taken-off');
  });

  test('need substantial views over the window', () => {
    expect(channelGroup(evidence({ windowViews: 99_999, subscribers: 500 }))).toBe('neither');
    expect(channelGroup(evidence({ windowViews: 100_000, subscribers: 500 }))).toBe('taken-off');
  });

  test('do not call a channel taken off when its own subscribers have stopped watching', () => {
    expect(channelGroup(evidence({ windowViews: 150_000, subscribers: 900_000 }))).toBe('neither');
    expect(channelGroup(evidence({ windowViews: 900_000, subscribers: 900_000 }))).toBe(
      'taken-off',
    );
  });

  test('judge a channel with a hidden subscriber count on its views alone', () => {
    expect(channelGroup(evidence({ subscribers: null }))).toBe('taken-off');
  });

  test('call a young channel far above its size rising while its totals are still small', () => {
    expect(
      channelGroup(evidence({ rising: true, windowViews: 12_000, widelySeenUploads: 1 })),
    ).toBe('rising');
    expect(
      channelGroup(evidence({ rising: true, windowViews: 99_000, widelySeenUploads: 9 })),
    ).toBe('rising');
  });

  test('call a young channel taken off once it meets the same bar as any other', () => {
    expect(channelGroup(evidence({ rising: true }))).toBe('taken-off');
  });

  test('put every channel in exactly one of the three', () => {
    const groups: ChannelGroup[] = ['taken-off', 'rising', 'neither'];
    for (const rising of [true, false]) {
      for (const widelySeenUploads of [0, 3]) {
        for (const windowViews of [0, 500_000]) {
          expect(groups).toContain(
            channelGroup(evidence({ rising, widelySeenUploads, windowViews })),
          );
        }
      }
    }
  });
});

interface Item {
  readonly id: string;
  readonly group: ChannelGroup;
}

const items = (takenOff: number, rising: number, neither = 0): readonly Item[] => [
  ...Array.from({ length: takenOff }, (_, n) => ({ id: `T${n + 1}`, group: 'taken-off' as const })),
  ...Array.from({ length: rising }, (_, n) => ({ id: `R${n + 1}`, group: 'rising' as const })),
  ...Array.from({ length: neither }, (_, n) => ({ id: `N${n + 1}`, group: 'neither' as const })),
];
const groupOf = (item: Item): ChannelGroup => item.group;
const letters = (list: readonly Item[]): string => list.map((item) => item.id.charAt(0)).join('');

describe('mixOrder', () => {
  test('interleaves the groups so the list opens about seven to three', () => {
    expect(letters(mixOrder(items(14, 6), groupOf))).toBe('TRTTTRTTRTTRTTTRTTRT');
  });

  test.each([
    [6, 4, 2],
    [10, 7, 3],
    [12, 8, 4],
    [18, 13, 5],
    [20, 14, 6],
  ])(
    'keeps the first %i close to seven in ten: %i taken off, %i rising',
    (shown, taken, rising) => {
      const prefix = mixOrder(items(40, 20), groupOf).slice(0, shown);

      expect(mixSplit(prefix, groupOf)).toEqual({ takenOff: taken, rising, neither: 0 });
    },
  );

  test('is never more than one channel away from seven in ten, at any length', () => {
    const mixed = mixOrder(items(70, 30), groupOf);
    for (let shown = 1; shown <= mixed.length; shown += 1) {
      const { takenOff } = mixSplit(mixed.slice(0, shown), groupOf);
      expect(Math.abs(takenOff - 0.7 * shown)).toBeLessThanOrEqual(0.5 + 1e-9);
    }
  });

  test('fills from the other group when one runs out', () => {
    expect(letters(mixOrder(items(8, 1), groupOf))).toBe('TRTTTTTTT');
    expect(letters(mixOrder(items(1, 5), groupOf))).toBe('TRRRRR');
    expect(letters(mixOrder(items(0, 3), groupOf))).toBe('RRR');
  });

  test('places the channels in neither group after the two groups', () => {
    expect(letters(mixOrder(items(3, 1, 2), groupOf))).toBe('TRTTNN');
    expect(letters(mixOrder(items(0, 0, 3), groupOf))).toBe('NNN');
  });

  test('keeps each group in the order it was given', () => {
    const given = [...items(3, 2, 1)].reverse();

    expect(mixOrder(given, groupOf).map((item) => item.id)).toEqual([
      'T3',
      'R2',
      'T2',
      'T1',
      'R1',
      'N1',
    ]);
  });

  test('changes nothing in the list it was given, and nothing when run again', () => {
    const given = items(5, 3, 2);
    const before = given.map((item) => item.id);

    const mixed = mixOrder(given, groupOf);

    expect(given.map((item) => item.id)).toEqual(before);
    expect(mixOrder(mixed, groupOf)).toEqual(mixed);
    expect([...mixed].sort((a, b) => a.id.localeCompare(b.id))).toEqual(
      [...given].sort((a, b) => a.id.localeCompare(b.id)),
    );
  });

  test('counts the groups', () => {
    expect(mixSplit(items(15, 5, 2), groupOf)).toEqual({ takenOff: 15, rising: 5, neither: 2 });
  });
});

/** A niche unrelated to every fixture: the rule may not lean on any subject's words. */
const SUBJECTS = ['Rye', 'Focaccia', 'Bagels', 'Baguettes', 'Ciabatta', 'Brioche', 'Pizza'];
const bakingTitle = (n: number): string =>
  `How To Bake Sourdough ${SUBJECTS[n % SUBJECTS.length]} At Home`;

const channel = (letter: string, subscribers: number): StoredChannel => ({
  id: cid(letter),
  title: `Bakery ${letter}`,
  handle: null,
  subscribers,
  subscribersHidden: false,
  videoCount: null,
  fetchedAt: NOW,
});

const videos = (
  letter: string,
  views: number,
  daysAgo: readonly number[],
): readonly StoredVideo[] =>
  daysAgo.map((days, n) => ({
    id: `${letter}${String(n).padStart(10, '0')}`,
    channelId: cid(letter),
    title: bakingTitle(n),
    views,
    durationSeconds: 600,
    published: { date: new Date(NOW.getTime() - days * DAY_MS), precision: 'day', raw: `${days}d` },
    fetchedAt: NOW,
  }));

const member = (
  letter: string,
  subscribers: number,
  views: number,
  daysAgo: readonly number[],
): MapMemberData => ({
  channel: channel(letter, subscribers),
  steps: 1,
  videos: videos(letter, views, daysAgo),
});

/** Uploads over five months: the channel is established, and six fall inside the window. */
const ESTABLISHED = [3, 12, 25, 40, 55, 70, 110, 150];
/** Every upload inside the last two months: the whole channel is young. */
const YOUNG = [2, 9, 16, 30, 45];

describe('the look-alikes of a map, in a niche unlike any fixture', () => {
  const centre = member('Z', 5000, 2000, ESTABLISHED);
  const members = [
    member('A', 20_000, 40_000, ESTABLISHED),
    member('B', 20_000, 40_000, ESTABLISHED),
    member('C', 20_000, 40_000, ESTABLISHED),
    member('D', 20_000, 40_000, ESTABLISHED),
    member('E', 1000, 12_000, YOUNG),
    member('F', 1000, 12_000, YOUNG),
    member('G', 20_000, 500, ESTABLISHED),
  ];
  const rows = buildMapView({ center: centre, members, edges: [], now: NOW });
  const peers = rows.filter((row) => row.peer);

  test('are the same channels the matching rules chose, whatever their group', () => {
    expect(peers.map((row) => row.channel.title).sort()).toEqual(
      members.map((entry) => entry.channel.title).sort(),
    );
  });

  test('each carry their group', () => {
    const groups = new Map(peers.map((row) => [row.channel.title, row.metrics.group]));

    expect(groups.get('Bakery A')).toBe('taken-off');
    expect(groups.get('Bakery E')).toBe('rising');
    expect(groups.get('Bakery G')).toBe('neither');
  });

  test('come in the mixed order, with the channels in neither group last', () => {
    expect(peers.map((row) => row.metrics.group)).toEqual([
      'taken-off',
      'rising',
      'taken-off',
      'taken-off',
      'taken-off',
      'rising',
      'neither',
    ]);
  });

  test('carry the figures the group rests on', () => {
    expect(channelMetrics(members[0]?.videos ?? [], 20_000, NOW)).toMatchObject({
      group: 'taken-off',
      ninetyDayViews: 240_000,
      widelySeenUploads: 6,
    });
  });
});
