import type { BreakoutVideo, MapSnapshot, SnapshotChannel } from '@jgtube/core';
import { describe, expect, test } from 'vitest';
import { ApiError, createApi } from '../src/lib/api';
import { filterBreakouts, inScope } from '../src/lib/feed';
import {
  formatCount,
  formatDuration,
  formatScore,
  initials,
  percent,
  thumbnailUrl,
  watchUrl,
} from '../src/lib/format';
import { layoutRadar, RING_RADIUS } from '../src/lib/radarLayout';

const cid = (n: number) => `UC${String(n).padStart(22, '0')}`;
const CENTER = cid(0);

const channel = (n: number, overrides: Partial<SnapshotChannel> = {}): SnapshotChannel => ({
  id: cid(n),
  title: `Channel ${n}`,
  handle: null,
  subscribers: 1000 * n,
  steps: 1,
  tier: 'close',
  relevance: 1 / n,
  centerShare: 0.5,
  recentViews: 1000,
  recentUploads: 2,
  rising: false,
  breakout: null,
  recommendedBy: [],
  peer: true,
  outsideReason: null,
  removed: false,
  ...overrides,
});

describe('format', () => {
  test('shortens counts and marks unknown ones', () => {
    expect(formatCount(94_700)).toBe('94.7K');
    expect(formatCount(1_500_000)).toBe('1.5M');
    expect(formatCount(344)).toBe('344');
    expect(formatCount(null)).toBe('hidden');
  });

  test('writes multiples with one decimal below ten and none above', () => {
    expect(formatScore(7.94)).toBe('7.9×');
    expect(formatScore(83.4)).toBe('83×');
    expect(formatScore(1541.7)).toBe('1,542×');
  });

  test('writes durations as a clock', () => {
    expect(formatDuration(31)).toBe('0:31');
    expect(formatDuration(3956)).toBe('1:05:56');
    expect(formatDuration(null)).toBe('');
  });

  test('takes up to two initials from a channel name', () => {
    expect(initials('States 2050')).toBe('S2');
    expect(initials('MegaBuilds')).toBe('M');
    expect(initials('  the tesla space ')).toBe('TT');
    expect(initials('')).toBe('?');
  });

  test('writes shares as whole percentages', () => {
    expect(percent(0.842)).toBe('84%');
    expect(percent(0)).toBe('0%');
  });

  test('builds YouTube links only from well-formed video ids', () => {
    expect(watchUrl('uXuQF_PPg5U')).toBe('https://www.youtube.com/watch?v=uXuQF_PPg5U');
    expect(thumbnailUrl('uXuQF_PPg5U')).toBe('https://i.ytimg.com/vi/uXuQF_PPg5U/mqdefault.jpg');
    expect(watchUrl('javascript:alert(1)')).toBeNull();
    expect(thumbnailUrl('../../x')).toBeNull();
  });
});

describe('filterBreakouts', () => {
  const item = (score: number, channelSubscribers: number | null): BreakoutVideo => ({
    videoId: 'abcdefghijk',
    title: 'A video',
    views: 1000,
    ageDays: 3,
    publishedRaw: '3d ago',
    durationSeconds: 600,
    score,
    channelId: cid(1),
    channelTitle: 'Channel',
    channelSubscribers,
  });
  const items = [item(300, 500_000), item(60, 2000), item(8, 900), item(4, null)];

  test('keeps everything by default', () => {
    expect(filterBreakouts(items, 'all')).toHaveLength(4);
  });

  test('filters by multiple', () => {
    expect(filterBreakouts(items, '100x').map((i) => i.score)).toEqual([300]);
    expect(filterBreakouts(items, '50x').map((i) => i.score)).toEqual([300, 60]);
  });

  test('keeps only channels known to be under ten thousand subscribers', () => {
    expect(filterBreakouts(items, 'small').map((i) => i.score)).toEqual([60, 8]);
  });
});

describe('inScope', () => {
  const items = [
    channel(1),
    channel(2, { peer: false, outsideReason: 'larger' }),
    channel(3, { removed: true }),
  ];

  test('keeps only channels like the centre when asked for peers', () => {
    expect(inScope(items, 'peers').map((item) => item.id)).toEqual([cid(1)]);
  });

  test('keeps everything otherwise', () => {
    expect(inScope(items, 'all')).toHaveLength(3);
  });
});

describe('layoutRadar', () => {
  const snapshotOf = (
    channels: SnapshotChannel[],
    edges: MapSnapshot['edges'] = [],
  ): Pick<MapSnapshot, 'center' | 'channels' | 'edges'> => ({
    center: { id: CENTER, title: 'Centre', handle: null, subscribers: null, storedVideos: 3 },
    channels,
    edges,
  });
  const distance = (node: { x: number; y: number }) => Math.hypot(node.x, node.y);

  test('puts each channel on the ring for its tier', () => {
    const layout = layoutRadar(
      snapshotOf([
        channel(1, { tier: 'close' }),
        channel(2, { tier: 'medium' }),
        channel(3, { tier: 'far', steps: 2 }),
      ]),
    );

    const byId = new Map(layout.nodes.map((node) => [node.id, node]));
    expect(distance(byId.get(cid(1))!)).toBeCloseTo(RING_RADIUS.close, 0);
    expect(Math.abs(distance(byId.get(cid(2))!) - RING_RADIUS.medium)).toBeLessThanOrEqual(16);
    expect(distance(byId.get(cid(3))!)).toBeCloseTo(RING_RADIUS.far, 0);
  });

  test('keeps every node inside the visible height and apart from the others', () => {
    const channels = Array.from({ length: 60 }, (_, index) =>
      channel(index + 1, { tier: index < 8 ? 'close' : index < 30 ? 'medium' : 'far' }),
    );

    const { nodes } = layoutRadar(snapshotOf(channels));

    for (const node of nodes) expect(Math.abs(node.y)).toBeLessThanOrEqual(290);
    for (const [index, a] of nodes.entries()) {
      for (const b of nodes.slice(index + 1)) {
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(44);
      }
    }
  });

  test('shows the strongest channels per ring and counts the rest as hidden', () => {
    const channels = Array.from({ length: 40 }, (_, index) => channel(index + 1));

    const layout = layoutRadar(snapshotOf(channels));

    expect(layout.nodes.length).toBeLessThan(40);
    expect(layout.nodes[0]?.id).toBe(cid(1));
    expect(layout.hidden).toBe(40 - layout.nodes.length);
  });

  test('gives the same positions every time', () => {
    const channels = [channel(1), channel(2, { tier: 'medium' }), channel(3, { tier: 'far' })];

    expect(layoutRadar(snapshotOf(channels))).toEqual(layoutRadar(snapshotOf(channels)));
  });

  test('marks breakouts and rising channels on their nodes', () => {
    const breakout = { videoId: 'abcdefghijk', title: 'Hit', views: 9, score: 83 };
    const { nodes } = layoutRadar(
      snapshotOf([
        channel(1, { breakout, rising: true }),
        channel(2, { breakout: { ...breakout, score: 2 } }),
      ]),
    );

    expect(nodes[0]).toMatchObject({ badge: 83, rising: true });
    expect(nodes[1]).toMatchObject({ badge: null, rising: false });
  });

  test('draws a link from the centre to each direct neighbour, weighted by share', () => {
    const { nodes, links } = layoutRadar(
      snapshotOf(
        [channel(1), channel(2)],
        [
          { from: CENTER, to: cid(1), share: 0.7 },
          { from: CENTER, to: cid(2), share: 0.2 },
        ],
      ),
    );

    expect(links).toHaveLength(2);
    expect(links[0]).toMatchObject({ fromId: CENTER, toId: cid(1), x1: 0, y1: 0, strength: 0.7 });
    expect(links[0]).toMatchObject({ x2: nodes[0]?.x, y2: nodes[0]?.y });
  });

  test('links a second-step channel only to its strongest recommender', () => {
    const { links } = layoutRadar(
      snapshotOf(
        [channel(1), channel(2), channel(3, { tier: 'medium', steps: 2, centerShare: null })],
        [
          { from: cid(1), to: cid(3), share: 0.3 },
          { from: cid(2), to: cid(3), share: 0.6 },
        ],
      ),
    );

    expect(links.map((link) => [link.fromId, link.toId])).toEqual([[cid(2), cid(3)]]);
  });
});

describe('api', () => {
  const respond = (status: number, body: unknown) => async () =>
    new Response(JSON.stringify(body), { status });

  test('returns the data from a successful envelope', async () => {
    const api = createApi(respond(200, { success: true, data: { mapId: 7 }, error: null }));

    await expect(api.latestMap('@x')).resolves.toEqual({ mapId: 7 });
  });

  test('returns null when no map exists yet', async () => {
    const api = createApi(respond(404, { success: false, data: null, error: 'No map' }));

    await expect(api.latestMap('@x')).resolves.toBeNull();
  });

  test('raises the server message for other failures', async () => {
    const api = createApi(
      respond(400, { success: false, data: null, error: 'Not a valid channel' }),
    );

    await expect(api.latestMap('bad')).rejects.toThrow(new ApiError('Not a valid channel', 400));
  });

  test('raises a plain message when the reply is not the expected shape', async () => {
    const api = createApi(async () => new Response('<html>', { status: 502 }));

    await expect(api.job('j')).rejects.toThrow(/unexpected/i);
  });

  test('sends a crawl request as JSON and returns the job id', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const api = createApi(async (url, init) => {
      calls.push({ url, init });
      return new Response(
        JSON.stringify({ success: true, data: { jobId: 'job-1' }, error: null }),
        { status: 202 },
      );
    });

    await expect(api.startCrawl('@veritasium', 2)).resolves.toBe('job-1');
    expect(calls[0]?.url).toBe('/api/maps');
    expect(calls[0]?.init?.method).toBe('POST');
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ channel: '@veritasium', depth: 2 });
  });

  test('sends a removal for a competitor', async () => {
    const bodies: string[] = [];
    const api = createApi(async (_url, init) => {
      bodies.push(String(init?.body));
      return new Response(JSON.stringify({ success: true, data: {}, error: null }));
    });

    await api.setRemoved('UCa', 'UCb', true);

    expect(JSON.parse(bodies[0] ?? '{}')).toEqual({ center: 'UCa', channel: 'UCb', removed: true });
  });

  test('encodes the channel in the address when reading a map', async () => {
    const urls: string[] = [];
    const api = createApi(async (url) => {
      urls.push(url);
      return new Response(JSON.stringify({ success: true, data: {}, error: null }));
    });

    await api.latestMap('https://www.youtube.com/@a b');

    expect(urls[0]).toBe('/api/maps/latest?channel=https%3A%2F%2Fwww.youtube.com%2F%40a%20b');
  });
});
