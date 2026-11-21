import { beforeEach, describe, expect, test } from 'vitest';
import { buildEdges } from '../src/crawl/edges';
import { crawlMap, type CrawlDeps, type CrawlProgress } from '../src/crawl/crawl';
import { openDatabase, transactionRunner } from '../src/db/sqlite';
import { loadMapView } from '../src/map/view';
import { SqliteChannelRepo } from '../src/repos/sqliteChannelRepo';
import { SqliteEdgeRepo } from '../src/repos/sqliteEdgeRepo';
import { SqliteMapRepo } from '../src/repos/sqliteMapRepo';
import { SqliteVideoRepo } from '../src/repos/sqliteVideoRepo';
import type { ChannelSnapshot, SidebarItem, VideoItem, YouTubeSource } from '../src/sources/types';

const NOW = new Date('2026-11-20T12:00:00Z');
const DAY_MS = 86_400_000;

const cid = (letter: string) => `UC${letter.repeat(22)}`;
const vid = (letter: string, n: number) => `${letter}`.repeat(10) + String(n);

const rec = (letter: string, n = 0): SidebarItem => ({
  videoId: vid(letter, n),
  title: `Video by ${letter}`,
  channelId: cid(letter),
  channelName: `Channel ${letter}`,
  channelHandle: null,
  views: 1000,
  published: null,
});

describe('buildEdges', () => {
  const own = cid('X');

  test('counts the sampled videos each other channel appeared next to', () => {
    const sidebars = new Map([
      [vid('X', 1), [rec('A'), rec('A', 1), rec('B')]],
      [vid('X', 2), [rec('A'), rec('X')]],
      [vid('X', 3), [rec('B')]],
      [vid('X', 4), [rec('A')]],
    ]);

    const edges = buildEdges(own, sidebars, { topChannels: 15 });

    expect(edges).toEqual([
      { fromChannelId: own, toChannelId: cid('A'), hits: 3, sampled: 4, share: 0.75 },
      { fromChannelId: own, toChannelId: cid('B'), hits: 2, sampled: 4, share: 0.5 },
    ]);
  });

  test('drops channels seen next to only one video when four or more were sampled', () => {
    const sidebars = new Map([
      [vid('X', 1), [rec('A'), rec('C')]],
      [vid('X', 2), [rec('A')]],
      [vid('X', 3), []],
      [vid('X', 4), []],
    ]);

    expect(buildEdges(own, sidebars, { topChannels: 15 }).map((e) => e.toChannelId)).toEqual([
      cid('A'),
    ]);
  });

  test('keeps single appearances for a channel with fewer than four videos', () => {
    const sidebars = new Map([
      [vid('X', 1), [rec('A')]],
      [vid('X', 2), [rec('B')]],
    ]);

    expect(buildEdges(own, sidebars, { topChannels: 15 })).toHaveLength(2);
  });

  test('keeps only the strongest channels and ignores items without a channel', () => {
    const unknown: SidebarItem = { ...rec('Q'), channelId: null };
    const sidebars = new Map([
      [vid('X', 1), [rec('A'), rec('B'), rec('C'), unknown]],
      [vid('X', 2), [rec('A'), rec('B')]],
      [vid('X', 3), [rec('A')]],
    ]);

    expect(buildEdges(own, sidebars, { topChannels: 2 }).map((e) => e.toChannelId)).toEqual([
      cid('A'),
      cid('B'),
    ]);
  });

  test('returns nothing when no videos were sampled', () => {
    expect(buildEdges(own, new Map(), { topChannels: 15 })).toEqual([]);
  });
});

/** A small graph: C → A, B; A → D; B → D, C. */
class GraphSource implements YouTubeSource {
  fetched: string[] = [];
  sidebarCalls: string[] = [];
  failing = new Set<string>();
  private readonly links: Record<string, readonly string[]> = {
    C: ['A', 'B'],
    A: ['D'],
    B: ['D', 'C'],
    D: ['E'],
    E: [],
  };

  async resolveChannelId(): Promise<string> {
    return cid('C');
  }

  async fetchChannel(channelId: string): Promise<ChannelSnapshot> {
    const letter = channelId.charAt(2);
    if (this.failing.has(letter)) throw new Error(`cannot read ${letter}`);
    this.fetched.push(letter);
    const videos: VideoItem[] = [1, 2].map((n) => ({
      id: vid(letter, n),
      channelId,
      title: `${letter} video ${n}`,
      views: 1000 * n,
      durationSeconds: 600,
      published: { date: new Date(NOW.getTime() - n * DAY_MS), precision: 'day', raw: `${n}d ago` },
    }));
    return {
      channel: {
        id: channelId,
        title: `Channel ${letter}`,
        handle: `handle${letter}`,
        subscribers: 1000,
        subscribersHidden: false,
        videoCount: 2,
      },
      videos,
    };
  }

  async fetchVideoPage(): Promise<never> {
    throw new Error('fetchVideoPage is not used in this test');
  }

  async getSidebar(videoId: string): Promise<readonly SidebarItem[]> {
    this.sidebarCalls.push(videoId);
    return (this.links[videoId.charAt(0)] ?? []).map((letter) => rec(letter));
  }
}

let source: GraphSource;
let deps: CrawlDeps;

beforeEach(() => {
  const db = openDatabase(':memory:');
  source = new GraphSource();
  deps = {
    source,
    channels: new SqliteChannelRepo(db),
    videos: new SqliteVideoRepo(db),
    edges: new SqliteEdgeRepo(db),
    maps: new SqliteMapRepo(db),
    transact: transactionRunner(db),
    region: 'US',
    now: () => NOW,
  };
});

const stepsOf = (members: readonly { channelId: string; steps: number }[]) =>
  Object.fromEntries(members.map((m) => [m.channelId.charAt(2), m.steps]));

describe('crawlMap', () => {
  test('follows recommendations two steps out and records how far each channel is', async () => {
    const result = await crawlMap(deps, '@handleC');

    expect(stepsOf(result.members)).toEqual({ C: 0, A: 1, B: 1, D: 2 });
    expect(result.warnings).toEqual([]);
  });

  test('reads sidebars only for the centre and its direct neighbours', async () => {
    await crawlMap(deps, '@handleC');

    const expanded = new Set(source.sidebarCalls.map((id) => id.charAt(0)));
    expect([...expanded].sort()).toEqual(['A', 'B', 'C']);
    expect(source.fetched.sort()).toEqual(['A', 'B', 'C', 'D']);
  });

  test('stores the edges it found', async () => {
    await crawlMap(deps, '@handleC');

    expect(deps.edges.listFrom(cid('B'))?.edges).toEqual([
      { fromChannelId: cid('B'), toChannelId: cid('C'), hits: 2, sampled: 2, share: 1 },
      { fromChannelId: cid('B'), toChannelId: cid('D'), hits: 2, sampled: 2, share: 1 },
    ]);
  });

  test('stops at one step when asked to', async () => {
    const result = await crawlMap(deps, '@handleC', { depth: 1 });

    expect(stepsOf(result.members)).toEqual({ C: 0, A: 1, B: 1 });
  });

  test('never grows past the channel budget', async () => {
    const result = await crawlMap(deps, '@handleC', { maxChannels: 2 });

    expect(result.members).toHaveLength(2);
    expect(result.warnings.join(' ')).toMatch(/budget/i);
  });

  test('skips a neighbour it cannot read and says so', async () => {
    source.failing.add('A');

    const result = await crawlMap(deps, '@handleC');

    expect(stepsOf(result.members)).toEqual({ C: 0, B: 1, D: 2 });
    expect(result.warnings).toEqual([expect.stringMatching(/cannot read A/)]);
  });

  test('makes no requests when everything is already stored and fresh', async () => {
    await crawlMap(deps, '@handleC');
    const before = source.fetched.length + source.sidebarCalls.length;

    const second = await crawlMap(deps, '@handleC');

    expect(source.fetched.length + source.sidebarCalls.length).toBe(before);
    expect(stepsOf(second.members)).toEqual({ C: 0, A: 1, B: 1, D: 2 });
  });

  test('saves the map so it can be loaded again', async () => {
    const result = await crawlMap(deps, '@handleC');

    const saved = deps.maps.latestForCenter(cid('C'));
    expect(saved?.id).toBe(result.mapId);
    expect(saved?.depth).toBe(2);
    expect(saved?.members).toHaveLength(4);
  });

  test('reports progress as it goes', async () => {
    const events: CrawlProgress[] = [];

    await crawlMap(deps, '@handleC', { onProgress: (event) => events.push(event) });

    expect(events.map((e) => e.stage)).toContain('reading-recommendations');
    expect(events.at(-1)).toMatchObject({ stage: 'done', channels: 4 });
  });

  test('follows a third step when asked', async () => {
    const result = await crawlMap(deps, '@handleC', { depth: 3 });

    expect(result.members.map((m) => [m.channelId.charAt(2), m.steps])).toEqual([
      ['C', 0],
      ['A', 1],
      ['B', 1],
      ['D', 2],
      ['E', 3],
    ]);
  });

  test('rejects a depth outside one to three', async () => {
    await expect(crawlMap(deps, '@handleC', { depth: 5 })).rejects.toThrow(/depth/i);
  });
});

describe('crawlMap when the channel limit cannot fit every candidate', () => {
  /** C → A, B. A looks like C and weakly recommends X; B does not and strongly recommends Y. */
  const titles: Record<string, readonly string[]> = {
    C: ['America Just Built a Reactor', 'America Just Found Lithium'],
    A: ['America Just Built a Bridge', 'America Just Found Gas'],
    B: ['Ten Rifles Ranked', 'Tigers Avoid Elephants'],
  };
  const sidebars: Record<string, readonly string[]> = {
    [vid('C', 1)]: ['A', 'B'],
    [vid('C', 2)]: ['A', 'B'],
    [vid('A', 1)]: ['X'],
    [vid('B', 1)]: ['Y'],
    [vid('B', 2)]: ['Y'],
  };
  const lookalikeSource: YouTubeSource = {
    resolveChannelId: async () => cid('C'),
    fetchChannel: async (channelId) => {
      const letter = channelId.charAt(2);
      return {
        channel: {
          id: channelId,
          title: `Channel ${letter}`,
          handle: null,
          subscribers: 1000,
          subscribersHidden: false,
          videoCount: 2,
        },
        videos: [1, 2].map((n) => ({
          id: vid(letter, n),
          channelId,
          title: titles[letter]?.[n - 1] ?? `Something else ${n}`,
          views: 1000,
          durationSeconds: 600,
          published: {
            date: new Date(NOW.getTime() - n * DAY_MS),
            precision: 'day' as const,
            raw: `${n}d ago`,
          },
        })),
      };
    },
    fetchVideoPage: async () => {
      throw new Error('fetchVideoPage is not used in this test');
    },
    getSidebar: async (videoId) => (sidebars[videoId] ?? []).map((letter) => rec(letter)),
  };

  test('gives the remaining places to channels recommended by look-alikes', async () => {
    const result = await crawlMap({ ...deps, source: lookalikeSource }, '@handleC', {
      maxChannels: 4,
    });

    expect(result.members.map((m) => m.channelId.charAt(2))).toEqual(['C', 'A', 'B', 'X']);
  });
});

describe('crawlMap with a model channel', () => {
  const ids = (members: readonly { channelId: string }[]) =>
    members.map((member) => member.channelId.charAt(2)).sort();

  test('also explores from the model, one step out like the centre', async () => {
    const plain = await crawlMap(deps, '@handleC', { depth: 1 });
    const seeded = await crawlMap(deps, '@handleC', { depth: 1, model: cid('D') });

    expect(ids(plain.members)).toEqual(['A', 'B', 'C']);
    expect(ids(seeded.members)).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect(seeded.modelChannelId).toBe(cid('D'));
    expect(deps.maps.latestForCenter(cid('C'))?.modelChannelId).toBe(cid('D'));
  });

  test('ignores a model that is the centre itself', async () => {
    const result = await crawlMap(deps, '@handleC', { depth: 1, model: cid('C') });

    expect(result.modelChannelId).toBeNull();
    expect(result.warnings.join(' ')).toMatch(/model channel is the same/i);
    expect(ids(result.members)).toEqual(['A', 'B', 'C']);
  });

  test('fails with a clear message when the model cannot be read', async () => {
    source.failing.add('D');

    await expect(crawlMap(deps, '@handleC', { model: cid('D') })).rejects.toThrow(/model channel/i);
  });
});

describe('crawlMap and the stored snapshot', () => {
  test('freezes the map it made so it can be reopened unchanged', async () => {
    const result = await crawlMap(deps, '@handleC');

    const stored = deps.maps.findSnapshot(result.mapId);

    expect(stored).not.toBeNull();
    expect(JSON.parse(stored ?? '{}')).toMatchObject({
      snapshot: { mapId: result.mapId, depth: 2 },
    });
  });

  test('keeps the map and warns when the frozen copy cannot be saved', async () => {
    const events: string[] = [];
    const maps = deps.maps;
    const failing = {
      ...deps,
      maps: {
        create: maps.create.bind(maps),
        latestForCenter: maps.latestForCenter.bind(maps),
        listCenterIds: maps.listCenterIds.bind(maps),
        deleteForCenter: maps.deleteForCenter.bind(maps),
        findSnapshot: maps.findSnapshot.bind(maps),
        listRemoved: maps.listRemoved.bind(maps),
        setRemoved: maps.setRemoved.bind(maps),
        listKept: maps.listKept.bind(maps),
        setKept: maps.setKept.bind(maps),
        saveSnapshot: () => {
          throw new Error('disk full');
        },
      },
    };

    const result = await crawlMap(failing, '@handleC', {
      onProgress: (event) => events.push(event.stage),
    });

    expect(maps.latestForCenter(result.centerChannelId)?.id).toBe(result.mapId);
    expect(result.warnings.join(' ')).toMatch(/disk full/);
    expect(events.at(-1)).toBe('done');
  });
});

describe('loadMapView', () => {
  test('loads a crawled map from the store, nearest channels first', async () => {
    const result = await crawlMap(deps, '@handleC');

    const view = loadMapView(deps, result.members, result.depth, NOW);

    expect(view?.center.channel.title).toBe('Channel C');
    expect(view?.rows.map((row) => row.channel.title)).toEqual([
      'Channel A',
      'Channel B',
      'Channel D',
    ]);
    expect(view?.rows[2]?.recommendedBy.map((r) => r.channelTitle)).toEqual([
      'Channel A',
      'Channel B',
    ]);
  });

  test('returns null when the centre channel is not in the store', () => {
    expect(loadMapView(deps, [{ channelId: cid('Z'), steps: 0 }], 2, NOW)).toBeNull();
  });
});
