/**
 * Crawl and map behaviour when YouTube pushes back, data is thin, or the store
 * already holds readings from other runs. Regression tests for review findings.
 */
import { beforeEach, describe, expect, test } from 'vitest';
import { crawlMap, type CrawlDeps } from '../src/crawl/crawl';
import { openDatabase, transactionRunner } from '../src/db/sqlite';
import { channelMetrics, loadMapView } from '../src/map/view';
import { SqliteChannelRepo } from '../src/repos/sqliteChannelRepo';
import { SqliteEdgeRepo } from '../src/repos/sqliteEdgeRepo';
import { SqliteMapRepo } from '../src/repos/sqliteMapRepo';
import { SqliteVideoRepo } from '../src/repos/sqliteVideoRepo';
import type { StoredVideo } from '../src/repos/types';
import type { ChannelSnapshot, SidebarItem, VideoItem, YouTubeSource } from '../src/sources/types';

const NOW = new Date('2026-11-20T12:00:00Z');
const DAY_MS = 86_400_000;
const cid = (letter: string) => `UC${letter.repeat(22)}`;
const vid = (letter: string, n: number) => `${letter}`.repeat(10) + String(n);

interface Scenario {
  readonly links: Readonly<Record<string, readonly string[]>>;
  readonly videosPerChannel?: Readonly<Record<string, number>>;
  readonly failingSidebars?: ReadonlySet<string>;
  readonly failingChannels?: ReadonlySet<string>;
}

class ScenarioSource implements YouTubeSource {
  fetched: string[] = [];
  sidebarCalls: string[] = [];
  constructor(private readonly scenario: Scenario) {}

  async resolveChannelId(): Promise<string> {
    return cid('C');
  }

  async fetchChannel(channelId: string): Promise<ChannelSnapshot> {
    const letter = channelId.charAt(2);
    this.fetched.push(letter);
    if (this.scenario.failingChannels?.has(letter)) throw new Error(`status 429 for ${letter}`);
    const count = this.scenario.videosPerChannel?.[letter] ?? 2;
    const videos: VideoItem[] = Array.from({ length: count }, (_, index) => ({
      id: vid(letter, index + 1),
      channelId,
      title: `${letter} video ${index + 1}`,
      views: 1000,
      durationSeconds: 600,
      published: {
        date: new Date(NOW.getTime() - (index + 1) * DAY_MS),
        precision: 'day',
        raw: `${index + 1}d ago`,
      },
    }));
    return {
      channel: {
        id: channelId,
        title: `Channel ${letter}`,
        handle: null,
        subscribers: 1000,
        subscribersHidden: false,
        videoCount: count,
      },
      videos,
    };
  }

  async fetchVideoPage(): Promise<never> {
    throw new Error('fetchVideoPage is not used in this test');
  }

  async getSidebar(videoId: string): Promise<readonly SidebarItem[]> {
    this.sidebarCalls.push(videoId);
    if (this.scenario.failingSidebars?.has(videoId)) throw new Error('boom');
    return (this.scenario.links[videoId.charAt(0)] ?? []).map((letter) => ({
      videoId: vid(letter, 0),
      title: `Video by ${letter}`,
      channelId: cid(letter),
      channelName: `Channel ${letter}`,
      channelHandle: null,
      views: 1000,
      published: null,
    }));
  }
}

let db: ReturnType<typeof openDatabase>;

const setup = (scenario: Scenario, region = 'US') => {
  const source = new ScenarioSource(scenario);
  const deps: CrawlDeps = {
    source,
    channels: new SqliteChannelRepo(db),
    videos: new SqliteVideoRepo(db),
    edges: new SqliteEdgeRepo(db),
    maps: new SqliteMapRepo(db),
    transact: transactionRunner(db),
    region,
    now: () => NOW,
  };
  return { source, deps };
};

const stepsOf = (members: readonly { channelId: string; steps: number }[]) =>
  Object.fromEntries(members.map((m) => [m.channelId.charAt(2), m.steps]));

beforeEach(() => {
  db = openDatabase(':memory:');
});

describe('crawlMap with unreliable sidebars', () => {
  const fiveVideos = { videosPerChannel: { C: 5 } };

  test('does not use or keep a reading built from too few sidebars', async () => {
    const { deps } = setup({
      links: { C: ['A', 'B'] },
      ...fiveVideos,
      failingSidebars: new Set([1, 2, 3, 4].map((n) => vid('C', n))),
    });

    const result = await crawlMap(deps, '@centre');

    expect(result.members).toHaveLength(1);
    expect(deps.edges.listFrom(cid('C'))).toBeNull();
    expect(result.warnings[0]).toMatch(/only 1 of 5 sidebars could be read \(boom\)/);
  });

  test('keeps a reading that is missing only a little, and says what was missed', async () => {
    const { deps } = setup({
      links: { C: ['A'] },
      ...fiveVideos,
      failingSidebars: new Set([vid('C', 1)]),
    });

    const result = await crawlMap(deps, '@centre', { depth: 1 });

    expect(stepsOf(result.members)).toEqual({ C: 0, A: 1 });
    expect(deps.edges.listFrom(cid('C'))?.edges[0]).toMatchObject({ hits: 4, sampled: 4 });
    expect(result.warnings).toEqual([expect.stringMatching(/Could not read 1 of 5 sidebars/)]);
  });

  test('does not record a reading for a channel that has no videos yet', async () => {
    const { deps } = setup({ links: { C: ['A'] }, videosPerChannel: { A: 0 } });

    const result = await crawlMap(deps, '@centre');

    expect(stepsOf(result.members)).toEqual({ C: 0, A: 1 });
    expect(deps.edges.listFrom(cid('A'))).toBeNull();
  });
});

describe('crawlMap when YouTube refuses requests', () => {
  test('stops after a run of failures instead of trying every channel', async () => {
    const neighbours = 'DEFGHIJKLMNO'.split('');
    const { deps, source } = setup({
      links: { C: neighbours },
      failingChannels: new Set(neighbours),
    });

    const result = await crawlMap(deps, '@centre');

    expect(source.fetched.filter((letter) => letter !== 'C')).toHaveLength(8);
    expect(result.members).toHaveLength(1);
    expect(result.warnings.filter((w) => w.startsWith('Skipped'))).toHaveLength(8);
    expect(result.warnings.at(-1)).toMatch(/Stopped early.*4 channels were not read/);
  });
});

describe('crawlMap reusing stored readings', () => {
  test('reads again when the stored reading is from another region', async () => {
    const scenario = { links: { C: ['A'] } };
    const first = setup(scenario, 'US');
    await crawlMap(first.deps, '@centre', { depth: 1 });
    const second = setup(scenario, 'GB');

    await crawlMap(second.deps, '@centre', { depth: 1 });

    expect(second.source.sidebarCalls).toHaveLength(2);
    expect(second.deps.edges.listFrom(cid('C'))?.region).toBe('GB');
  });

  test('applies a smaller channel limit to a stored reading', async () => {
    const { deps } = setup({ links: { C: ['A', 'B'] } });
    await crawlMap(deps, '@centre', { depth: 1 });

    const narrower = await crawlMap(deps, '@centre', { depth: 1, topChannels: 1 });

    expect(stepsOf(narrower.members)).toEqual({ C: 0, A: 1 });
  });

  test('keeps a direct neighbour at one step when a second path also reaches it', async () => {
    const { deps } = setup({ links: { C: ['A', 'B'], A: ['B', 'D'] } });

    const result = await crawlMap(deps, '@centre');

    expect(stepsOf(result.members)).toEqual({ C: 0, A: 1, B: 1, D: 2 });
  });
});

describe('loadMapView with readings left by other crawls', () => {
  test('ignores edges out of channels this map did not expand', async () => {
    const { deps } = setup({ links: { C: ['A'], A: ['D'] } });
    const result = await crawlMap(deps, '@centre');
    deps.edges.replaceFrom(
      cid('D'),
      [{ fromChannelId: cid('D'), toChannelId: cid('A'), hits: 2, sampled: 2, share: 1 }],
      'US',
      NOW,
    );

    const view = loadMapView(deps, result.members, result.depth, NOW);

    const a = view?.rows.find((row) => row.channel.title === 'Channel A');
    expect(a?.recommendedBy.map((r) => r.channelTitle)).toEqual(['Channel C']);
  });
});

describe('channelMetrics rising rule', () => {
  let counter = 0;
  const video = (views: number, daysAgo: number): StoredVideo => {
    counter += 1;
    return {
      id: `r${String(counter).padStart(10, '0')}`,
      channelId: cid('R'),
      title: 'A video',
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

  test('flags a young channel with two strong breakouts even when subscribers are hidden', () => {
    const videos = [
      video(20_000, 5),
      video(20_000, 8),
      video(1000, 10),
      video(1000, 12),
      video(1000, 15),
      video(1000, 20),
    ];

    expect(channelMetrics(videos, null, NOW).rising).toBe(true);
  });

  test('does not call a channel young when the fetch may have missed older videos', () => {
    const videos = Array.from({ length: 100 }, (_, index) => video(50_000, (index + 1) / 2));

    expect(channelMetrics(videos, 100, NOW).rising).toBe(false);
  });
});
