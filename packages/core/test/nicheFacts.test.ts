import { beforeEach, describe, expect, test } from 'vitest';
import { openDatabase } from '../src/db/sqlite';
import { MAX_FACTS_PER_RUN, fillNicheFacts, type FactsDeps } from '../src/niches/facts';
import { loadNicheList } from '../src/niches/niches';
import { SqliteChannelRepo } from '../src/repos/sqliteChannelRepo';
import { SqliteFactsRepo } from '../src/repos/sqliteFactsRepo';
import { SqliteMapRepo } from '../src/repos/sqliteMapRepo';
import { SqliteVideoRepo } from '../src/repos/sqliteVideoRepo';
import { SqliteWatchlistRepo } from '../src/repos/sqliteWatchlistRepo';
import type { ChannelFacts } from '../src/sources/dataApi';

const NOW = new Date('2026-11-20T12:00:00Z');
const DAY_MS = 86_400_000;
const CREATED = new Date('2018-03-04T10:00:00Z');
const cid = (letter: string) => `UC${letter.repeat(22)}`;

const factsFor = (letter: string, country: string | null = 'US'): ChannelFacts => ({
  id: cid(letter),
  createdAt: CREATED,
  country,
  totalViews: 123_456,
  videoCount: 5,
  subscribers: 2000,
  subscribersHidden: false,
});

let deps: FactsDeps;
let asked: string[][];
let answer: (ids: readonly string[]) => Promise<readonly ChannelFacts[]>;

/** Stores a small channel 40 days old; with `hit` its newest video has taken off, so it is a niche. */
function store(letter: string, hit = true): void {
  deps.channels.upsert(
    {
      id: cid(letter),
      title: `Channel ${letter}`,
      handle: `handle${letter}`,
      subscribers: 2000,
      subscribersHidden: false,
      videoCount: 5,
    },
    NOW,
  );
  deps.videos.upsertMany(
    [hit ? 40_000 : 1000, 1000, 1200, 900, 1100].map((views, index) => ({
      id: letter.repeat(9) + String(index).padStart(2, '0'),
      channelId: cid(letter),
      title: `How ${letter} built thing ${index}`,
      views,
      durationSeconds: 900,
      published: {
        date: new Date(NOW.getTime() - (5 + index * 8) * DAY_MS),
        precision: 'day' as const,
        raw: `${5 + index * 8}d ago`,
      },
    })),
    NOW,
  );
}

beforeEach(() => {
  const db = openDatabase(':memory:');
  asked = [];
  answer = async (ids) => ids.map((id) => factsFor(id.charAt(2)));
  deps = {
    channels: new SqliteChannelRepo(db),
    videos: new SqliteVideoRepo(db),
    maps: new SqliteMapRepo(db),
    watchlist: new SqliteWatchlistRepo(db),
    facts: new SqliteFactsRepo(db),
    fetchFacts: (ids) => {
      asked.push([...ids]);
      return answer(ids);
    },
  };
});

describe('SqliteFactsRepo', () => {
  test('has nothing for a channel whose facts were never asked for', () => {
    store('A');

    expect(deps.facts.find(cid('A'))).toBeNull();
    expect(deps.facts.listMissing([cid('A'), cid('Z')])).toEqual([cid('A')]);
  });

  test('stores a channel’s creation date, country and total views', () => {
    store('A');

    deps.facts.record([cid('A')], [factsFor('A', 'GB')], NOW);

    expect(deps.facts.find(cid('A'))).toEqual({
      channelId: cid('A'),
      createdAt: CREATED,
      country: 'GB',
      totalViews: 123_456,
      fetchedAt: NOW,
    });
    expect(deps.facts.listMissing([cid('A')])).toEqual([]);
  });

  test('remembers that a channel was asked about when the API knew nothing of it', () => {
    store('A');

    deps.facts.record([cid('A')], [], NOW);

    expect(deps.facts.find(cid('A'))).toBeNull();
    expect(deps.facts.listMissing([cid('A')])).toEqual([]);
  });

  test('keeps the facts when the channel is read again', () => {
    store('A');
    deps.facts.record([cid('A')], [factsFor('A')], NOW);

    store('A');

    expect(deps.facts.find(cid('A'))?.createdAt).toEqual(CREATED);
    expect(deps.channels.findById(cid('A'))?.title).toBe('Channel A');
  });

  test('ignores facts for a channel that is not in the store', () => {
    deps.facts.record([cid('Q')], [factsFor('Q')], NOW);

    expect(deps.facts.find(cid('Q'))).toBeNull();
  });
});

describe('fillNicheFacts', () => {
  test('uses the list of channels it is handed instead of working the niche list out again', async () => {
    store('A');
    store('B', false);
    let videoReads = 0;
    const videos = Object.assign(Object.create(deps.videos) as typeof deps.videos, {
      listByChannel: (channelId: string) => {
        videoReads += 1;
        return deps.videos.listByChannel(channelId);
      },
    });

    const outcome = await fillNicheFacts({ ...deps, videos }, NOW, [cid('B')]);

    expect(asked).toEqual([[cid('B')]]);
    expect(outcome).toEqual({ asked: 1, added: 1, problem: null });
    expect(videoReads).toBe(0);
  });

  test('asks only for the channels on the niche list, and stores what comes back', async () => {
    store('A');
    store('B', false);
    store('D');
    deps.watchlist.setWatched(cid('B'), true, NOW);
    store('E', false);

    const outcome = await fillNicheFacts(deps, NOW);

    expect(asked.map((ids) => [...ids].sort())).toEqual([[cid('A'), cid('B'), cid('D')]]);
    expect(outcome).toEqual({ asked: 3, added: 3, problem: null });
    expect(deps.facts.find(cid('D'))?.country).toBe('US');
    expect(deps.facts.find(cid('E'))).toBeNull();
  });

  test('does not ask again for channels it already has, and makes no request with none left', async () => {
    store('A');
    store('D');
    deps.facts.record([cid('A')], [factsFor('A')], NOW);

    await fillNicheFacts(deps, NOW);
    const again = await fillNicheFacts(deps, NOW);

    expect(asked).toEqual([[cid('D')]]);
    expect(again).toEqual({ asked: 0, added: 0, problem: null });
  });

  test('counts only the channels the API knew', async () => {
    store('A');
    store('D');
    answer = async () => [factsFor('A')];

    expect(await fillNicheFacts(deps, NOW)).toEqual({ asked: 2, added: 1, problem: null });
    expect((await fillNicheFacts(deps, NOW)).asked).toBe(0);
  });

  test('reports a refusal instead of failing, and asks again next time', async () => {
    store('A');
    answer = async () => {
      throw new Error('The YouTube API key has used up its daily allowance.');
    };

    const outcome = await fillNicheFacts(deps, NOW);

    expect(outcome).toEqual({
      asked: 1,
      added: 0,
      problem: 'The YouTube API key has used up its daily allowance.',
    });
    expect(deps.facts.listMissing([cid('A')])).toEqual([cid('A')]);
  });

  test('asks for a bounded number of channels in one go', () => {
    expect(MAX_FACTS_PER_RUN).toBe(200);
  });
});

describe('facts on the niche list', () => {
  test('shows the creation date and country once they are stored, and null before', () => {
    store('A');
    const before = loadNicheList(deps, NOW).channels[0];
    deps.facts.record([cid('A')], [factsFor('A', null)], NOW);
    const after = loadNicheList(deps, NOW).channels[0];

    expect(before).toMatchObject({ createdAt: null, country: null });
    expect(after).toMatchObject({ createdAt: CREATED.toISOString(), country: null });
  });

  test('leaves them out when the list is built without a facts store', () => {
    store('A');
    deps.facts.record([cid('A')], [factsFor('A')], NOW);
    const withoutFacts = {
      channels: deps.channels,
      videos: deps.videos,
      maps: deps.maps,
      watchlist: deps.watchlist,
    };

    expect(loadNicheList(withoutFacts, NOW).channels[0]).toMatchObject({
      createdAt: null,
      country: null,
    });
  });
});
