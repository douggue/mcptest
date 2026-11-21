import type { BreakoutVideo, MapSnapshot, SnapshotChannel } from '@jgtube/core';
import { SMALL_CHANNEL_MAX_SUBSCRIBERS } from '@jgtube/core/src/limits';
import { NICHE_SMALL_MAX_SUBSCRIBERS } from '@jgtube/core/src/niches/niches';
import { describe, expect, test } from 'vitest';
import { ApiError, createApi } from '../src/lib/api';
import {
  competitorActions,
  describeEvidence,
  filterBreakouts,
  inScope,
  unsettledNote,
} from '../src/lib/feed';
import {
  formatCount,
  formatDuration,
  formatScore,
  initials,
  percent,
  thumbnailUrl,
  watchUrl,
  formatAge,
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
  group: 'neither',
  ninetyDayViews: 0,
  widelySeenUploads: 0,
  breakout: null,
  recommendedBy: [],
  peer: true,
  outsideReason: null,
  settled: true,
  removed: false,
  kept: false,
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
    // A tiny score is not rounded to a misleading 0.0×.
    expect(formatScore(0.04)).toBe('<0.1×');
    expect(formatScore(0)).toBe('0×');
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
    baseline: 1200,
    sampleSize: 12,
    channelHits: 3,
    channelScored: 14,
    channelAgeDays: 150,
    caution: null,
  });
  const items = [item(300, 500_000), item(60, 2000), item(8, 900), item(4, null)];

  test('says in words what a score rests on', () => {
    expect(describeEvidence(item(8, 900))).toBe(
      'Usually 1.2K views · compared with 12 videos · 3 of 14 recent videos broke out · channel about 5 months old',
    );
    expect(describeEvidence({ ...item(8, 900), sampleSize: 1, channelAgeDays: null })).toBe(
      'Usually 1.2K views · compared with 1 video · 3 of 14 recent videos broke out',
    );
  });

  test.each([
    [0, 'under a day'],
    [1, '1 day'],
    [9, '9 days'],
    [21, '3 weeks'],
    [150, '5 months'],
    [800, '2 years'],
  ])('describes an age of %d days as %s', (days, text) => {
    expect(formatAge(days)).toBe(text);
  });

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

  test('draws the small line where the engine draws it, not at a copy of the number', () => {
    const sized = (subscribers: number) => ({ ...items[0]!, channelSubscribers: subscribers });
    const edge = [
      sized(SMALL_CHANNEL_MAX_SUBSCRIBERS - 1),
      sized(SMALL_CHANNEL_MAX_SUBSCRIBERS),
      sized(SMALL_CHANNEL_MAX_SUBSCRIBERS + 1),
    ];

    expect(filterBreakouts(edge, 'small').map((item) => item.channelSubscribers)).toEqual([
      SMALL_CHANNEL_MAX_SUBSCRIBERS - 1,
    ]);
    expect(NICHE_SMALL_MAX_SUBSCRIBERS).toBe(SMALL_CHANNEL_MAX_SUBSCRIBERS);
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

describe('unsettledNote', () => {
  const note = (overrides: Partial<SnapshotChannel>) => unsettledNote(channel(1, overrides));

  test('says nothing about a call that holds whoever else is on the map', () => {
    expect(note({})).toBeNull();
    expect(note({ peer: false, outsideReason: 'larger' })).toBeNull();
  });

  test('says a look-alike is not a firm yes when its call changes with the map', () => {
    expect(note({ settled: false })).toMatch(
      /^Not settled: counted as like yours on this map, but/,
    );
  });

  test('says a channel left out is not a firm no when its call changes with the map', () => {
    expect(note({ settled: false, peer: false, outsideReason: 'titles' })).toMatch(
      /^Not settled: left out on this map, but/,
    );
  });

  test('says nothing once the owner has decided', () => {
    expect(note({ settled: false, kept: true, outsideReason: 'titles' })).toBeNull();
    expect(note({ settled: false, removed: true })).toBeNull();
  });

  test('treats a copy without the mark as settled', () => {
    const older = { peer: true };

    expect(unsettledNote(older)).toBeNull();
  });
});

describe('competitorActions', () => {
  const offered = (overrides: Partial<SnapshotChannel>) =>
    competitorActions(channel(1, overrides)).map((action) => [action.status, action.label]);

  test('offers to remove a channel that counts as like the centre', () => {
    expect(offered({})).toEqual([['removed', 'Not a competitor: remove']]);
  });

  test('offers to keep a channel the filter left out, or to remove it for good', () => {
    expect(offered({ peer: false, outsideReason: 'titles' })).toEqual([
      ['kept', 'Keep as a competitor'],
      ['removed', 'Not a competitor: remove'],
    ]);
  });

  test('offers to undo a keep, or to remove the channel instead', () => {
    expect(offered({ kept: true, outsideReason: 'larger' })).toEqual([
      ['auto', 'Kept by you: undo'],
      ['removed', 'Not a competitor: remove'],
    ]);
  });

  test('offers only to restore a removed channel', () => {
    expect(offered({ removed: true })).toEqual([['auto', 'Restore to my competitors']]);
    expect(offered({ removed: true, peer: false, outsideReason: 'titles' })).toEqual([
      ['auto', 'Restore to my competitors'],
    ]);
  });

  test('treats a copy without the kept mark as not kept', () => {
    const older = { peer: false };

    expect(competitorActions(older).map((action) => action.status)).toEqual(['kept', 'removed']);
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

  test('carries each channel’s logo to its node, and null when it has none', () => {
    const { nodes } = layoutRadar(
      snapshotOf([
        channel(1, { tier: 'close', logoUrl: 'https://yt3.googleusercontent.com/one=s176' }),
        channel(2, { tier: 'close' }),
      ]),
    );

    expect(nodes.map((node) => node.logoUrl)).toEqual([
      'https://yt3.googleusercontent.com/one=s176',
      null,
    ]);
  });

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

  test('fills each ring with look-alikes in the taken-off-and-rising mix', () => {
    // Ten that have taken off are listed before the two that are rising, as a
    // list cut down to one ring is: the ring's eight places must still hold both.
    const channels = [
      ...Array.from({ length: 10 }, (_, n) => channel(n + 1, { group: 'taken-off' })),
      channel(11, { group: 'rising' }),
      channel(12, { group: 'rising' }),
    ];

    const shown = layoutRadar(snapshotOf(channels)).nodes.map((node) => node.id);

    expect(shown).toEqual([1, 11, 2, 3, 4, 12, 5, 6].map(cid));
  });

  test('places look-alikes on a ring before the channels that are not', () => {
    const channels = [
      channel(1, { peer: false, group: 'rising' }),
      channel(2, { group: 'neither' }),
      channel(3, { group: 'taken-off' }),
    ];

    const shown = layoutRadar(snapshotOf(channels)).nodes.map((node) => node.id);

    expect(shown).toEqual([3, 2, 1].map(cid));
  });

  test('gives the same positions every time', () => {
    const channels = [channel(1), channel(2, { tier: 'medium' }), channel(3, { tier: 'far' })];

    expect(layoutRadar(snapshotOf(channels))).toEqual(layoutRadar(snapshotOf(channels)));
  });

  test('marks breakouts and rising channels on their nodes', () => {
    const breakout = { videoId: 'abcdefghijk', title: 'Hit', views: 9, score: 83 };
    const { nodes } = layoutRadar(
      snapshotOf([
        channel(1, { breakout, rising: true, group: 'rising' }),
        // Young and above its size, but already past the bar: taken off, so not drawn as rising.
        channel(3, { rising: true, group: 'taken-off' }),
        channel(2, { breakout: { ...breakout, score: 2 } }),
      ]),
    );

    expect(nodes.find((node) => node.id === cid(1))).toMatchObject({ badge: 83, rising: true });
    expect(nodes.find((node) => node.id === cid(2))).toMatchObject({ badge: null, rising: false });
    expect(nodes.find((node) => node.id === cid(3))).toMatchObject({ rising: false });
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

  test('lists the channels a map has been made for', async () => {
    const channels = [{ id: 'UCabc', title: 'One', handle: 'one' }];
    const asked: string[] = [];
    const api = createApi(async (url) => {
      asked.push(String(url));
      return new Response(JSON.stringify({ success: true, data: { channels }, error: null }));
    });

    await expect(api.savedChannels()).resolves.toEqual(channels);
    expect(asked).toEqual(['/api/maps']);
  });

  test('asks for a saved channel to be deleted', async () => {
    const sent: string[] = [];
    const api = createApi(async (url, init) => {
      sent.push(`${init?.method} ${String(url)} ${String(init?.body)}`);
      return new Response(
        JSON.stringify({ success: true, data: { channel: 'UCabc' }, error: null }),
      );
    });

    await api.deleteSavedChannel('UCabc');

    expect(sent).toEqual(['POST /api/maps/delete {"channel":"UCabc"}']);
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

  test('sends the model channel with a new map only when one is given', async () => {
    const bodies: string[] = [];
    const api = createApi(async (_url, init) => {
      bodies.push(String(init?.body));
      return new Response(JSON.stringify({ success: true, data: { jobId: 'j' }, error: null }));
    });

    await api.startCrawl('@mine', 2, '  @model ');
    await api.startCrawl('@mine', 2, '  ');
    await api.startCrawl('@mine', 3, '', 300);

    expect(bodies.map((body) => JSON.parse(body))).toEqual([
      { channel: '@mine', depth: 2, model: '@model' },
      { channel: '@mine', depth: 2 },
      { channel: '@mine', depth: 3, maxChannels: 300 },
    ]);
  });

  test('sends the owner’s say on a competitor', async () => {
    const calls: Array<{ url: string; body: string }> = [];
    const api = createApi(async (url, init) => {
      calls.push({ url, body: String(init?.body) });
      return new Response(JSON.stringify({ success: true, data: {}, error: null }));
    });

    await api.setCompetitorStatus('UCa', 'UCb', 'kept');
    await api.setCompetitorStatus('UCa', 'UCb', 'auto');

    expect(calls.map((entry) => entry.url)).toEqual(['/api/competitors', '/api/competitors']);
    expect(calls.map((entry) => JSON.parse(entry.body))).toEqual([
      { center: 'UCa', channel: 'UCb', status: 'kept' },
      { center: 'UCa', channel: 'UCb', status: 'auto' },
    ]);
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
