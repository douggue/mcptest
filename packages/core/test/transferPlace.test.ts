import { beforeEach, describe, expect, test } from 'vitest';
import { openDatabase } from '../src/db/sqlite';
import { SqliteChannelRepo } from '../src/repos/sqliteChannelRepo';
import { SqliteFactsRepo } from '../src/repos/sqliteFactsRepo';
import { SqliteMapRepo } from '../src/repos/sqliteMapRepo';
import { SqliteOwnerPlaceRepo } from '../src/repos/sqliteOwnerPlaceRepo';
import { SqliteTransferRepo } from '../src/repos/sqliteTransferRepo';
import { SqliteVideoRepo } from '../src/repos/sqliteVideoRepo';
import { channelsLackingCountry, readCountries } from '../src/transfer/countries';
import { listPlaces } from '../src/transfer/places';
import { loadTransferList, type TransferDeps } from '../src/transfer/transfers';

const NOW = new Date('2026-11-20T12:00:00Z');
const DAY_MS = 86_400_000;
const cid = (name: string) => `UC${name.padEnd(22, '_').slice(0, 22)}`;

interface Store extends TransferDeps {
  readonly channels: SqliteChannelRepo;
  readonly videos: SqliteVideoRepo;
  readonly facts: SqliteFactsRepo;
  readonly maps: SqliteMapRepo;
  readonly ownerPlaces: SqliteOwnerPlaceRepo;
}

let store: Store;
let videoCount = 0;

function addChannel(name: string, country?: string | null): void {
  store.channels.upsert(
    {
      id: cid(name),
      title: name,
      handle: null,
      subscribers: 5000,
      subscribersHidden: false,
      videoCount: null,
    },
    NOW,
  );
  // `undefined` leaves the channel never asked about; null is asked and unknown.
  if (country !== undefined) {
    store.facts.record(
      [cid(name)],
      country === null ? [] : [{ id: cid(name), createdAt: NOW, country, totalViews: null }],
      NOW,
    );
  }
}

function addVideo(channel: string, title: string, views: number): void {
  videoCount += 1;
  store.videos.upsertMany(
    [
      {
        id: `p${String(videoCount).padStart(10, '0')}`,
        channelId: cid(channel),
        title,
        views,
        durationSeconds: 600,
        published: {
          date: new Date(NOW.getTime() - 10 * DAY_MS),
          precision: 'day',
          raw: '10d ago',
        },
      },
    ],
    NOW,
  );
}

function addMap(centre: string, others: readonly string[]): void {
  store.maps.create(
    {
      centerChannelId: cid(centre),
      depth: 1,
      region: 'US',
      members: [
        { channelId: cid(centre), steps: 0 },
        ...others.map((name) => ({ channelId: cid(name), steps: 1 })),
      ],
    },
    NOW,
  );
}

/** A centre whose titles are about Kenya, and two channels that made one idea for two places. */
function seed(centreCountry?: string | null): void {
  addChannel('Mine', centreCountry);
  addVideo('Mine', 'Kenya Builds A Railway', 1000);
  addVideo('Mine', 'Kenya Finds Water', 1000);
  addChannel('Kenyan', 'KE');
  addChannel('Abroad', 'GB');
  addChannel('Unasked');
  addVideo('Kenyan', 'Kenya Opens A Giant Solar Farm', 300_000);
  addVideo('Abroad', 'Chile Opens A Giant Solar Farm', 800);
  addVideo('Unasked', 'Peru Opens A Giant Solar Farm', 500);
  addMap('Mine', ['Kenyan', 'Abroad', 'Unasked']);
}

const listFor = (place?: { key: string; name: string }) =>
  loadTransferList(store, NOW, {
    centerChannelId: cid('Mine'),
    ...(place ? { ownerPlace: place } : {}),
  });

beforeEach(() => {
  const db = openDatabase(':memory:');
  store = {
    channels: new SqliteChannelRepo(db),
    videos: new SqliteVideoRepo(db),
    facts: new SqliteFactsRepo(db),
    maps: new SqliteMapRepo(db),
    transfers: new SqliteTransferRepo(db),
    ownerPlaces: new SqliteOwnerPlaceRepo(db),
  };
});

describe('the place Jgtube uses for the channel on screen', () => {
  test('says what the titles name and what the channel’s country is, and that they agree', () => {
    seed('KE');

    const { ownerPlace, placeCheck } = listFor();

    expect(ownerPlace).toEqual({ key: 'KE', name: 'Kenya', source: 'titles' });
    expect(placeCheck).toEqual({
      channelId: cid('Mine'),
      chosen: null,
      fromTitles: { key: 'KE', name: 'Kenya' },
      fromCountry: { key: 'KE', name: 'Kenya' },
      countryCode: 'KE',
      countryAsked: true,
      disagree: false,
    });
  });

  test('flags a channel whose titles are about one place and whose country is another', () => {
    seed('GB');

    const { ownerPlace, placeCheck } = listFor();

    expect(ownerPlace?.source).toBe('titles');
    expect(placeCheck.fromCountry?.key).toBe('GB');
    expect(placeCheck.disagree).toBe(true);
  });

  test('says when the country was never asked for, and when it was asked and is not known', () => {
    seed();
    expect(listFor().placeCheck).toMatchObject({ fromCountry: null, countryAsked: false });

    store.facts.record([cid('Mine')], [], NOW);
    expect(listFor().placeCheck).toMatchObject({
      fromCountry: null,
      countryCode: null,
      countryAsked: true,
      disagree: false,
    });
  });

  test('uses the place the owner chose for this channel, from then on', () => {
    seed('GB');
    store.ownerPlaces.set(cid('Mine'), 'CA', NOW);

    const { ownerPlace, placeCheck } = listFor();

    expect(ownerPlace).toEqual({ key: 'CA', name: 'Canada', source: 'owner' });
    expect(placeCheck.chosen).toEqual({ key: 'CA', name: 'Canada' });
    expect(placeCheck.fromTitles?.key).toBe('KE');
  });

  test('a place named for one request still wins, and a cleared choice gives way again', () => {
    seed('GB');
    store.ownerPlaces.set(cid('Mine'), 'CA', NOW);
    expect(listFor({ key: 'ZA', name: 'South Africa' }).ownerPlace?.source).toBe('given');

    store.ownerPlaces.set(cid('Mine'), null, NOW);
    expect(listFor().ownerPlace?.source).toBe('titles');
    expect(listFor().placeCheck.chosen).toBeNull();
  });

  test('the choice is kept per channel', () => {
    seed('GB');
    store.ownerPlaces.set(cid('Kenyan'), 'CA', NOW);

    expect(listFor().placeCheck.chosen).toBeNull();
    expect(store.ownerPlaces.find(cid('Kenyan'))).toBe('CA');
  });

  test('with no channel on screen there is nothing to check', () => {
    seed('KE');

    expect(loadTransferList(store, NOW).placeCheck).toMatchObject({
      channelId: null,
      chosen: null,
      fromTitles: null,
      fromCountry: null,
    });
  });
});

describe('each version of an idea', () => {
  test('carries its channel’s country beside the place its title names', () => {
    seed('KE');

    const idea = listFor().ideas.find((candidate) => candidate.versions.length === 3);
    const byChannel = new Map(idea?.versions.map((version) => [version.channelTitle, version]));

    expect(byChannel.get('Kenyan')).toMatchObject({
      place: { key: 'KE', source: 'title' },
      channelCountry: { key: 'KE', name: 'Kenya' },
      elsewhere: false,
    });
    expect(byChannel.get('Abroad')).toMatchObject({
      place: { key: 'CL', source: 'title' },
      channelCountry: { key: 'GB', name: 'UK' },
      elsewhere: true,
    });
    expect(byChannel.get('Unasked')).toMatchObject({ channelCountry: null, elsewhere: false });
  });
});

describe('the countries still to be read', () => {
  test('are the centre’s and those of the channels behind the listed ideas, never asked about', () => {
    seed();

    expect(listFor().countriesMissing).toBe(2);
    expect([...channelsLackingCountry(store, listFor(), cid('Mine'))].sort()).toEqual(
      [cid('Mine'), cid('Unasked')].sort(),
    );
  });

  test('are read through the official API and stored, so they are not asked for again', async () => {
    seed();
    const asked: string[][] = [];

    const outcome = await readCountries(
      {
        ...store,
        facts: store.facts,
        fetchFacts: async (ids) => {
          asked.push([...ids]);
          return [{ id: cid('Mine'), createdAt: NOW, country: 'KE', totalViews: null }];
        },
      },
      NOW,
      cid('Mine'),
    );

    expect(asked).toHaveLength(1);
    expect(outcome).toEqual({ asked: 2, added: 1, problem: null });
    expect(listFor().placeCheck).toMatchObject({ countryCode: 'KE', countryAsked: true });
    expect(listFor().countriesMissing).toBe(0);
  });

  test('a refusal is reported, not thrown, and nothing is marked as asked', async () => {
    seed();

    const outcome = await readCountries(
      { ...store, facts: store.facts, fetchFacts: () => Promise.reject(new Error('quota')) },
      NOW,
      cid('Mine'),
    );

    expect(outcome).toEqual({ asked: 2, added: 0, problem: 'quota' });
    expect(listFor().countriesMissing).toBe(2);
  });

  test('nothing is asked when nothing is missing', async () => {
    seed('KE');
    store.facts.record([cid('Unasked')], [], NOW);

    const outcome = await readCountries(
      { ...store, facts: store.facts, fetchFacts: () => Promise.reject(new Error('not reached')) },
      NOW,
      cid('Mine'),
    );

    expect(outcome).toEqual({ asked: 0, added: 0, problem: null });
  });
});

describe('the list of places the owner chooses from', () => {
  test('is every place Jgtube knows, by name, each once', () => {
    const places = listPlaces();
    const names = places.map((place) => place.name);

    expect(places.length).toBeGreaterThan(150);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    expect(new Set(places.map((place) => place.key)).size).toBe(places.length);
    expect(places).toContainEqual({ key: 'CA', name: 'Canada' });
  });
});

describe('the owner’s place in the store', () => {
  test('is replaced by a new choice and removed by clearing', () => {
    addChannel('Mine');

    store.ownerPlaces.set(cid('Mine'), 'CA', NOW);
    store.ownerPlaces.set(cid('Mine'), 'KE', NOW);
    expect(store.ownerPlaces.find(cid('Mine'))).toBe('KE');

    store.ownerPlaces.set(cid('Mine'), null, NOW);
    expect(store.ownerPlaces.find(cid('Mine'))).toBeNull();
  });
});
