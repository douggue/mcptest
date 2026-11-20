import { describe, expect, test } from 'vitest';
import { titleSimilarity } from '../src/map/relevance';
import { buildMapView, channelMetrics, type MapMemberData } from '../src/map/view';
import type { RecEdge, StoredChannel, StoredVideo } from '../src/repos/types';

const NOW = new Date('2026-11-20T12:00:00Z');
const DAY_MS = 86_400_000;
const cid = (letter: string) => `UC${letter.repeat(22)}`;

const channel = (letter: string, subscribers: number | null = 1000): StoredChannel => ({
  id: cid(letter),
  title: `Channel ${letter}`,
  handle: null,
  subscribers,
  subscribersHidden: subscribers === null,
  videoCount: null,
  fetchedAt: NOW,
});

let nextVideo = 0;
const video = (letter: string, views: number, daysAgo: number, title = 'A video'): StoredVideo => {
  nextVideo += 1;
  return {
    id: `v${String(nextVideo).padStart(10, '0')}`,
    channelId: cid(letter),
    title,
    views,
    durationSeconds: 600,
    published: {
      date: new Date(NOW.getTime() - daysAgo * DAY_MS),
      precision: 'day',
      raw: `${daysAgo}d ago`,
    },
    fetchedAt: NOW,
  };
};

const edge = (from: string, to: string, share: number): RecEdge => ({
  fromChannelId: cid(from),
  toChannelId: cid(to),
  hits: Math.round(share * 10),
  sampled: 10,
  share,
});

describe('channelMetrics', () => {
  test('adds up views on uploads from the last 30 days only', () => {
    const videos = [video('A', 500, 5), video('A', 700, 29), video('A', 9000, 45)];

    expect(channelMetrics(videos, 1000, NOW)).toMatchObject({
      recentViews: 1200,
      recentUploads: 2,
    });
  });

  test('reports the best recent breakout with the video it came from', () => {
    const hit = video('A', 50_000, 40, 'The hit');
    const videos = [hit, video('A', 1000, 20), video('A', 1000, 35), video('A', 1000, 50)];

    const metrics = channelMetrics(videos, 1000, NOW);

    expect(metrics.breakout?.videoId).toBe(hit.id);
    expect(metrics.breakout?.title).toBe('The hit');
    expect(metrics.breakout?.score).toBeCloseTo(50, 0);
  });

  test('ignores a breakout older than 60 days', () => {
    const videos = [
      video('A', 50_000, 80),
      video('A', 1000, 20),
      video('A', 1000, 35),
      video('A', 1000, 50),
    ];

    expect(channelMetrics(videos, 1000, NOW).breakout?.score).toBeLessThan(2);
  });

  test('flags a young channel whose recent views dwarf its subscribers as rising', () => {
    const videos = [video('A', 30_000, 5), video('A', 200, 12), video('A', 300, 30)];

    expect(channelMetrics(videos, 1000, NOW).rising).toBe(true);
  });

  test('does not flag an established channel as rising', () => {
    const videos = [video('A', 30_000, 5), video('A', 200, 12), video('A', 300, 400)];

    expect(channelMetrics(videos, 1000, NOW).rising).toBe(false);
  });

  test('handles a channel with no videos', () => {
    expect(channelMetrics([], null, NOW)).toEqual({
      recentViews: 0,
      recentUploads: 0,
      breakout: null,
      rising: false,
    });
  });
});

describe('titleSimilarity', () => {
  const centre = [
    'America Just Built a Humanoid Robot Factory',
    'America Just Found Lithium Under Arkansas',
  ];

  test('scores a channel with the same title format above an unrelated one', () => {
    const scores = titleSimilarity(
      centre,
      new Map([
        ['twin', ['America Just Built a Fusion Reactor', 'America Just Found Rare Earths']],
        ['other', ['Top 10 Hunting Rifles Ranked', 'Why Tigers Avoid Elephants']],
      ]),
    );

    expect(scores.get('twin')).toBeGreaterThan(0.3);
    expect(scores.get('other')).toBe(0);
  });

  test('scores identical titles close to one and empty input as zero', () => {
    const scores = titleSimilarity(
      centre,
      new Map([
        ['same', centre],
        ['empty', []],
      ]),
    );

    expect(scores.get('same')).toBeGreaterThan(0.95);
    expect(scores.get('same')).toBeLessThanOrEqual(1);
    expect(scores.get('empty')).toBe(0);
  });

  test('weighs a reference word by the share of its titles that use it', () => {
    const reference = ['Forever Tires', 'Forever Magnets', 'Forever Stoves', 'Forever Mirrors'];

    const scores = titleSimilarity(
      reference,
      new Map([
        ['format', ['Forever']],
        ['subject', ['Tires']],
      ]),
    );

    // Used in four titles against one: the format word counts four times the subject word.
    expect((scores.get('format') ?? 0) / (scores.get('subject') ?? 1)).toBeCloseTo(4, 5);
  });

  test('counts a word once per title however often the title repeats it', () => {
    const scores = titleSimilarity(
      ['Robots Robots Robots', 'Tires'],
      new Map([
        ['robots', ['Robots']],
        ['tires', ['Tires']],
      ]),
    );

    expect(scores.get('robots')).toBeCloseTo(scores.get('tires') ?? 0, 5);
  });

  test('returns zero for everything when the centre has no titles', () => {
    expect(titleSimilarity([], new Map([['x', ['Some title']]])).get('x')).toBe(0);
  });
});

describe('buildMapView', () => {
  const member = (letter: string, steps: number, titles: string[] = []): MapMemberData => ({
    channel: channel(letter),
    steps,
    videos: titles.map((title, index) => video(letter, 1000, 10 + index, title)),
  });

  const view = () =>
    buildMapView({
      center: member('C', 0, ['America Just Built a Robot', 'America Just Found Lithium']),
      members: [
        member('A', 1, ['America Just Built a Reactor', 'America Just Found Gas']),
        member('B', 1, ['Ten Rifles Ranked', 'Tigers Avoid Elephants']),
        member('D', 2, ['America Just Launched a Rocket']),
        member('E', 2),
      ],
      edges: [
        edge('C', 'A', 0.7),
        edge('C', 'B', 0.3),
        edge('A', 'D', 0.4),
        edge('B', 'D', 0.4),
        edge('B', 'E', 0.2),
      ],
      now: NOW,
    });

  test('ranks channels by how similar their titles are, then by closeness', () => {
    expect(view().map((row) => row.channel.title)).toEqual([
      'Channel A',
      'Channel D',
      'Channel B',
      'Channel E',
    ]);
  });

  test('assigns tiers from distance and recommendation strength', () => {
    const tiers = Object.fromEntries(view().map((row) => [row.channel.title, row.tier]));

    expect(tiers).toEqual({
      'Channel A': 'close',
      'Channel B': 'medium',
      'Channel D': 'medium',
      'Channel E': 'far',
    });
  });

  test('lists who recommends each channel, strongest first', () => {
    const d = view().find((row) => row.channel.title === 'Channel D');

    expect(d?.recommendedBy.map((r) => r.channelTitle)).toEqual(['Channel A', 'Channel B']);
    expect(d?.recommendedBy[0]?.share).toBe(0.4);
  });

  test('gives each channel a title-similarity score against the centre', () => {
    const scores = Object.fromEntries(view().map((row) => [row.channel.title, row.relevance]));

    expect(scores['Channel A']).toBeGreaterThan(scores['Channel B'] ?? 1);
    expect(scores['Channel E']).toBe(0);
  });

  test('measures channels against the model channel when one is given', () => {
    const input = {
      center: member('C', 0, ['My First Vlog', 'A Quiet Walk']),
      members: [
        member('M', 1, ['America Just Built a Reactor', 'America Just Found Gas']),
        member('A', 2, ['America Just Launched a Rocket', 'America Just Built a Bridge']),
        member('B', 2, ['Ten Rifles Ranked', 'Tigers Avoid Elephants']),
      ],
      edges: [edge('C', 'M', 0.5), edge('M', 'A', 0.5), edge('M', 'B', 0.5)],
      now: NOW,
    };

    const rows = buildMapView({ ...input, modelId: cid('M') });
    const peers = rows.filter((row) => row.peer).map((row) => row.channel.title);

    expect(peers).toEqual(expect.arrayContaining(['Channel M', 'Channel A']));
    expect(peers).not.toContain('Channel B');
  });

  test('counts a strong link from the model as close, like one from the centre', () => {
    const rows = buildMapView({
      center: member('C', 0),
      members: [member('M', 1), member('A', 1), member('B', 1)],
      edges: [edge('M', 'A', 0.7), edge('M', 'B', 0.1)],
      now: NOW,
      modelId: cid('M'),
    });
    const tier = (letter: string) => rows.find((row) => row.channel.id === cid(letter))?.tier;

    expect([tier('M'), tier('A'), tier('B')]).toEqual(['close', 'close', 'medium']);
  });

  test('treats a mutual recommendation as close', () => {
    const rows = buildMapView({
      center: member('C', 0),
      members: [member('A', 1)],
      edges: [edge('C', 'A', 0.2), edge('A', 'C', 0.2)],
      now: NOW,
    });

    expect(rows[0]?.tier).toBe('close');
  });
});
