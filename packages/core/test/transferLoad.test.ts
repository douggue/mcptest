import { beforeEach, describe, expect, test } from 'vitest';
import { openDatabase } from '../src/db/sqlite';
import { SqliteChannelRepo } from '../src/repos/sqliteChannelRepo';
import { SqliteFactsRepo } from '../src/repos/sqliteFactsRepo';
import { SqliteMapRepo } from '../src/repos/sqliteMapRepo';
import { SqliteTransferRepo } from '../src/repos/sqliteTransferRepo';
import { SqliteVideoRepo } from '../src/repos/sqliteVideoRepo';
import type { StorableVideo } from '../src/sources/types';
import {
  loadTransferList,
  TRANSFER_WINDOW_DAYS,
  type TransferDeps,
} from '../src/transfer/transfers';

const NOW = new Date('2026-11-20T12:00:00Z');
const DAY_MS = 86_400_000;
const cid = (name: string) => `UC${name.padEnd(22, '_').slice(0, 22)}`;

interface Store extends TransferDeps {
  readonly channels: SqliteChannelRepo;
  readonly videos: SqliteVideoRepo;
  readonly facts: SqliteFactsRepo;
  readonly maps: SqliteMapRepo;
  readonly transfers: SqliteTransferRepo;
}

let store: Store;
let videoCount = 0;

function addChannel(name: string, subscribers: number | null, country: string | null = null) {
  store.channels.upsert(
    {
      id: cid(name),
      title: name,
      handle: null,
      subscribers,
      subscribersHidden: subscribers === null,
      videoCount: null,
    },
    NOW,
  );
  if (country !== null) {
    store.facts.record(
      [cid(name)],
      [{ id: cid(name), createdAt: NOW, country, totalViews: null }],
      NOW,
    );
  }
}

const storable = (
  channel: string,
  title: string,
  views: number,
  daysAgo: number,
): StorableVideo => {
  videoCount += 1;
  return {
    id: `t${String(videoCount).padStart(10, '0')}`,
    channelId: cid(channel),
    title,
    views,
    durationSeconds: 600,
    published: {
      date: new Date(NOW.getTime() - daysAgo * DAY_MS),
      precision: 'day',
      raw: `${daysAgo}d ago`,
    },
  };
};

const addVideo = (channel: string, title: string, views: number, daysAgo = 10): void =>
  store.videos.upsertMany([storable(channel, title, views, daysAgo)], NOW);

function addMap(centre: string, madeDaysAgo: number): void {
  store.maps.create(
    {
      centerChannelId: cid(centre),
      depth: 1,
      region: 'US',
      members: [{ channelId: cid(centre), steps: 0 }],
    },
    new Date(NOW.getTime() - madeDaysAgo * DAY_MS),
  );
}

beforeEach(() => {
  const db = openDatabase(':memory:');
  store = {
    channels: new SqliteChannelRepo(db),
    videos: new SqliteVideoRepo(db),
    facts: new SqliteFactsRepo(db),
    maps: new SqliteMapRepo(db),
    transfers: new SqliteTransferRepo(db),
  };
});

/** Two small channels that made one title for Kenya and for Chile; Kenya's took off. */
function seedSolarIdea(): void {
  addChannel('Kenyan', 5000);
  addChannel('Chilean', 5000);
  addVideo('Kenyan', 'Kenya Opens A Giant Solar Farm', 300_000);
  addVideo('Chilean', 'Chile Opens A Giant Solar Farm', 800);
}

function addCentre(name: string, place: string, madeDaysAgo: number): void {
  addChannel(name, 100);
  addVideo(name, `${place} Just Built A Dam`, 50);
  addVideo(name, `${place} Opens A New Mine`, 50);
  addMap(name, madeDaysAgo);
}

describe('loadTransferList: the owner’s place', () => {
  test('is read from the titles of the channel the owner maps from', () => {
    seedSolarIdea();
    addCentre('Mine', 'Peru', 1);

    const list = loadTransferList(store, NOW);

    expect(list.ownerPlace).toEqual({ key: 'PE', name: 'Peru', source: 'titles' });
    expect(list.ideas[0]).toMatchObject({ opportunity: true, verdict: { status: 'open' } });
  });

  test('is not known, and nothing is called an opportunity, with no map made', () => {
    seedSolarIdea();

    const list = loadTransferList(store, NOW);

    expect(list.ownerPlace).toBeNull();
    expect(list.ideas[0]?.verdict.status).toBe('unplaced');
  });

  test('is the centre of the most recent map when two centres disagree', () => {
    seedSolarIdea();
    addCentre('Older', 'Chile', 9);
    addCentre('Newer', 'Peru', 2);

    expect(loadTransferList(store, NOW).ownerPlace?.name).toBe('Peru');
  });

  test('is the place of the channel on screen, whichever map is newer', () => {
    seedSolarIdea();
    addCentre('Older', 'Chile', 9);
    addCentre('Newer', 'Peru', 2);

    const list = loadTransferList(store, NOW, { centerChannelId: cid('Older') });

    expect(list.ownerPlace).toEqual({ key: 'CL', name: 'Chile', source: 'titles' });
    // Chile's own version got 800 views against Kenya's 300,000.
    expect(list.ideas[0]?.verdict).toMatchObject({ status: 'weak', own: { views: 800 } });
  });

  test('falls back to the map centres when the channel on screen says nothing', () => {
    seedSolarIdea();
    addCentre('Mine', 'Peru', 1);
    addChannel('Cook', 100);
    addVideo('Cook', 'How To Fold Dumplings', 50);

    expect(loadTransferList(store, NOW, { centerChannelId: cid('Cook') }).ownerPlace?.name).toBe(
      'Peru',
    );
    expect(loadTransferList(store, NOW, { centerChannelId: cid('Nobody') }).ownerPlace?.name).toBe(
      'Peru',
    );
  });

  test('is the centre’s country when its titles name no place', () => {
    seedSolarIdea();
    addChannel('Cook', 100, 'CA');
    addVideo('Cook', 'How To Fold Dumplings', 50);
    addMap('Cook', 1);

    expect(loadTransferList(store, NOW).ownerPlace).toEqual({
      key: 'CA',
      name: 'Canada',
      source: 'country',
    });
  });

  test('is whatever the owner says it is, over anything worked out', () => {
    seedSolarIdea();
    addCentre('Mine', 'Peru', 1);

    const list = loadTransferList(store, NOW, { ownerPlace: { key: 'KE', name: 'Kenya' } });

    expect(list.ownerPlace).toEqual({ key: 'KE', name: 'Kenya', source: 'given' });
    expect(list.ideas[0]?.verdict.status).toBe('done');
  });
});

describe('loadTransferList: what it reads', () => {
  test('leaves out videos older than the window', () => {
    seedSolarIdea();
    addVideo('Chilean', 'Peru Opens A Giant Solar Farm', 9_000_000, TRANSFER_WINDOW_DAYS + 1);

    const list = loadTransferList(store, NOW);

    expect(list.videosChecked).toBe(2);
    expect(list.ideas[0]?.versionCount).toBe(2);
  });

  test('scores a version against its channel’s usual views, older videos included', () => {
    addChannel('Large', 400_000);
    addChannel('Chilean', 5000);
    addCentre('Mine', 'Peru', 1);
    addVideo('Large', 'Kenya Opens A Giant Solar Farm', 200_000, 20);
    // Twelve ordinary videos, most of them older than the window, set the usual at 5,000 views.
    Array.from({ length: 12 }, (_, index) =>
      addVideo('Large', `An Ordinary Upload Number ${index}`, 5000, 25 + index * 15),
    );
    addVideo('Chilean', 'Chile Opens A Giant Solar Farm', 800);

    const [idea] = loadTransferList(store, NOW).ideas;

    // 200,000 views is half its subscribers, but forty times what it usually gets.
    expect(idea?.versions[0]?.score).toBeGreaterThan(20);
    expect(idea?.versions[0]?.strong).toBe(true);
    expect(idea?.verdict.status).toBe('open');
  });

  test('shows the ideas the owner saved, and keeps one whose videos have aged out', () => {
    seedSolarIdea();
    store.transfers.setSaved('{place} opens giant solar farm', 'x', true, NOW);
    store.transfers.setSaved('a b c', 'a b c', true, NOW);

    const list = loadTransferList(store, NOW);

    expect(list.ideas.map((idea) => [idea.key, idea.saved, idea.verdict.status])).toEqual([
      ['{place} opens giant solar farm', true, 'unplaced'],
      ['a b c', true, 'gone'],
    ]);
  });
});

describe('loadTransferList over a large store', () => {
  const CHANNELS = 300;
  const RECENT_PER_CHANNEL = 40;
  const OLD_PER_CHANNEL = 15;
  const PLANTED = 25;
  /**
   * Generous for work that grows with the number of videos (well under a
   * second here) and far too short for comparing every title with every
   * other: 12,000 titles are 72 million pairs.
   */
  const TIME_LIMIT_MS = 5000;
  const WORDS = 'river engine market garden signal harbor copper window ladder orbit'.split(' ');
  const word = (seed: number): string => WORDS[seed % WORDS.length] ?? 'river';
  const name = (index: number): string => `Chan${String(index).padStart(4, '0')}`;

  /** A title no other video shares: its last two words are unique to it. */
  const unique = (channel: number, n: number): string =>
    `The ${word(channel)} ${word(n)} ${word(channel + n)} story part${channel}x${n} take${n}x${channel}`;

  function seedLargeStore(): void {
    const all: StorableVideo[] = [];
    for (let channel = 0; channel < CHANNELS; channel += 1) {
      addChannel(name(channel), 5000);
      for (let n = 0; n < RECENT_PER_CHANNEL; n += 1) {
        all.push(storable(name(channel), unique(channel, n), 1000 + n, 1 + (n % 80)));
      }
      for (let n = 0; n < OLD_PER_CHANNEL; n += 1) {
        all.push(storable(name(channel), unique(channel, 500 + n), 1000, 100 + n));
      }
    }
    // Twenty-five ideas, each made by two channels for two countries; one of the two took off.
    for (let idea = 0; idea < PLANTED; idea += 1) {
      const title = (place: string) => `${place} Builds The ${word(idea)} Machine Plan${idea}x Now`;
      all.push(storable(name(idea * 2), title('Kenya'), 400_000, 10));
      all.push(storable(name(idea * 2 + 1), title('Chile'), 900, 12));
    }
    store.videos.upsertMany(all, NOW);
    addCentre('Mine', 'Peru', 1);
  }

  test('finds the ideas without comparing every title with every other or loading every channel', () => {
    seedLargeStore();
    const loaded: string[] = [];
    const counting: TransferDeps = {
      ...store,
      videos: {
        listByChannel: (channelId) => {
          loaded.push(channelId);
          return store.videos.listByChannel(channelId);
        },
        upsertMany: (videos, at) => store.videos.upsertMany(videos, at),
        listSnapshots: (videoId) => store.videos.listSnapshots(videoId),
        listChannelReadings: (channelId, since) =>
          store.videos.listChannelReadings(channelId, since),
      },
    };

    const started = performance.now();
    const list = loadTransferList(counting, NOW);
    const elapsed = performance.now() - started;

    expect(list.videosChecked).toBe(CHANNELS * RECENT_PER_CHANNEL + PLANTED * 2 + 2);
    expect(list.ideaCount).toBe(PLANTED);
    expect(list.opportunityCount).toBe(PLANTED);
    // The fifty channels that share an idea, and the one centre; none of the other 250.
    expect(new Set(loaded).size).toBe(PLANTED * 2 + 1);
    expect(loaded.length).toBe(PLANTED * 2 + 1);
    expect(elapsed).toBeLessThan(TIME_LIMIT_MS);
  });
});
