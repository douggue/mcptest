import type { ChannelSnapshot, TransferList, YouTubeSource } from '@jgtube/core';
import { describe, expect, test } from 'vitest';
import { createApp, type TransferChoices } from '../src/app';
import { createEngine } from '../src/engine';
import { JobStore } from '../src/jobs';
import { CHANNEL_ID, HOST, get, post, read, stubEngine } from './support';

const PATH = '/api/transfers';
const SAVE = '/api/transfers/save';
const KEY = '{place} just found fuel shouldn exist';

const list: TransferList = {
  ownerPlace: { key: 'US', name: 'America', source: 'titles' },
  windowDays: 90,
  videosChecked: 12,
  ideas: [],
  ideaCount: 0,
  opportunityCount: 0,
  formats: [],
  formatCount: 0,
};

interface Calls {
  readonly reads: TransferChoices[];
  readonly saves: Array<[string, boolean]>;
}

function appWith(calls: Calls = { reads: [], saves: [] }, known: readonly string[] = [KEY]) {
  const engine = stubEngine({
    listTransfers: (choices = {}) => {
      calls.reads.push(choices);
      return list;
    },
    setTransferSaved: (key, saved) => {
      if (saved && !known.includes(key)) return false;
      calls.saves.push([key, saved]);
      return true;
    },
  });
  return createApp({ engine, jobs: new JobStore(), allowedHosts: [HOST] });
}

describe('GET /api/transfers', () => {
  test('returns the transfer list in the standard envelope', async () => {
    const calls: Calls = { reads: [], saves: [] };

    const response = await get(appWith(calls), PATH);

    expect(response.status).toBe(200);
    expect(await read(response)).toEqual({ success: true, data: list, error: null, meta: null });
    expect(calls.reads).toEqual([{}]);
  });

  test('passes on the channel on screen and the place the owner names', async () => {
    const calls: Calls = { reads: [], saves: [] };

    await get(appWith(calls), `${PATH}?channel=${CHANNEL_ID}&place=South%20Africa`);
    await get(appWith(calls), `${PATH}?channel=%40somehandle&place=gb`);

    expect(calls.reads).toEqual([
      { channel: CHANNEL_ID, place: { key: 'ZA', name: 'South Africa' } },
      { channel: '@somehandle', place: { key: 'GB', name: 'UK' } },
    ]);
  });

  test('rejects a channel it cannot read or a place it does not know, without asking the engine', async () => {
    const calls: Calls = { reads: [], saves: [] };
    const app = appWith(calls);

    const badChannel = await get(app, `${PATH}?channel=not%20a%20channel!`);
    const badPlace = await get(app, `${PATH}?place=Atlantis`);

    expect(badChannel.status).toBe(400);
    expect(badPlace.status).toBe(400);
    expect((await read(badPlace)).error).toBe(
      'Jgtube does not know that place. Give a country, such as Canada, or its two-letter code.',
    );
    expect(calls.reads).toEqual([]);
  });

  test('rejects a place name too long to be one', async () => {
    expect((await get(appWith(), `${PATH}?place=${'a'.repeat(200)}`)).status).toBe(400);
  });

  test('only answers to GET, and only to its own address', async () => {
    const app = appWith();

    expect((await post(app, PATH, {})).status).toBe(405);
    expect((await get(app, PATH, 'evil.example')).status).toBe(403);
  });
});

describe('POST /api/transfers/save', () => {
  test('saves an idea and can stop saving it', async () => {
    const calls: Calls = { reads: [], saves: [] };
    const app = appWith(calls);

    const saved = await post(app, SAVE, { key: KEY, saved: true });
    await post(app, SAVE, { key: KEY, saved: false });

    expect(saved.status).toBe(200);
    expect(await read(saved)).toEqual({
      success: true,
      data: { key: KEY, saved: true },
      error: null,
      meta: null,
    });
    expect(calls.saves).toEqual([
      [KEY, true],
      [KEY, false],
    ]);
  });

  test('answers 404 for an idea that is not among the recent videos', async () => {
    const response = await post(appWith(), SAVE, { key: 'some other idea', saved: true });

    expect(response.status).toBe(404);
    expect(await read(response)).toMatchObject({ success: false, data: null });
  });

  test.each([
    [{ key: '', saved: true }],
    [{ key: 'x'.repeat(301), saved: true }],
    [{ key: 12, saved: true }],
    [{ key: KEY, saved: 'yes' }],
    [{ key: KEY }],
    [{ saved: true }],
    ['{not json'],
  ])('rejects %j', async (body) => {
    const calls: Calls = { reads: [], saves: [] };

    expect((await post(appWith(calls), SAVE, body)).status).toBe(400);
    expect(calls.saves).toEqual([]);
  });

  test('rejects a body that is too large', async () => {
    const calls: Calls = { reads: [], saves: [] };

    const response = await post(appWith(calls), SAVE, {
      key: KEY,
      saved: true,
      padding: 'x'.repeat(3000),
    });

    expect(response.status).toBe(400);
    expect(calls.saves).toEqual([]);
  });

  test('rejects requests sent from another site', async () => {
    const calls: Calls = { reads: [], saves: [] };

    const response = await post(
      appWith(calls),
      SAVE,
      { key: KEY, saved: true },
      { origin: 'https://evil.example' },
    );

    expect(response.status).toBe(403);
    expect(calls.saves).toEqual([]);
  });

  test('requires a JSON content type', async () => {
    const calls: Calls = { reads: [], saves: [] };

    const response = await post(
      appWith(calls),
      SAVE,
      { key: KEY, saved: true },
      { 'content-type': 'text/plain' },
    );

    expect(response.status).toBe(415);
    expect(calls.saves).toEqual([]);
  });

  test('only answers to POST, and only to its own address', async () => {
    const calls: Calls = { reads: [], saves: [] };
    const app = appWith(calls);

    expect((await get(app, SAVE)).status).toBe(405);
    const foreign = await app(
      new Request(`http://evil.example${SAVE}`, {
        method: 'POST',
        headers: { host: 'evil.example', 'content-type': 'application/json' },
        body: JSON.stringify({ key: KEY, saved: true }),
      }),
    );
    expect(foreign.status).toBe(403);
    expect(calls.saves).toEqual([]);
  });
});

describe('the transfer list with the real engine and store', () => {
  const NOW = new Date('2026-11-20T12:00:00Z');
  const cid = (letter: string) => `UC${letter.repeat(22)}`;
  /** The centre makes videos for Peru; A and B made one title for Kenya and for Chile. */
  const TITLES: Readonly<Record<string, readonly (readonly [string, number])[]>> = {
    C: [
      ['Peru Just Built A Dam', 50],
      ['Peru Opens A New Mine', 60],
    ],
    A: [
      ['Kenya Opens A Giant Solar Farm', 300_000],
      ['Kenya Plants A Forest', 900],
    ],
    B: [
      ['Chile Opens A Giant Solar Farm', 800],
      ['Chile Plants A Vineyard', 700],
    ],
  };
  const source: YouTubeSource = {
    resolveChannelId: async () => cid('C'),
    fetchChannel: async (channelId): Promise<ChannelSnapshot> => {
      const letter = channelId.charAt(2);
      return {
        channel: {
          id: channelId,
          title: `Channel ${letter}`,
          handle: `handle${letter}`,
          subscribers: 5000,
          subscribersHidden: false,
          videoCount: 2,
        },
        videos: (TITLES[letter] ?? []).map(([title, views], n) => ({
          id: letter.repeat(10) + String(n),
          channelId,
          title,
          views,
          durationSeconds: 900,
          published: {
            date: new Date(NOW.getTime() - (n + 1) * 86_400_000),
            precision: 'day' as const,
            raw: `${n + 1}d ago`,
          },
        })),
      };
    },
    getSidebar: async (videoId) =>
      (videoId.startsWith('C') ? ['A', 'B'] : []).map((letter) => ({
        videoId: letter.repeat(10) + '0',
        title: `Video by ${letter}`,
        channelId: cid(letter),
        channelName: `Channel ${letter}`,
        channelHandle: null,
        views: 1000,
        published: null,
      })),
  };

  test('lists an idea, judges it for the owner’s place, and keeps it once saved', async () => {
    const real = createEngine(
      { dbPath: ':memory:', region: 'US' },
      { createSource: async () => source, now: () => NOW },
    );
    const live = createApp({ engine: real, jobs: new JobStore(), allowedHosts: [HOST] });
    const listed = async (query = '') =>
      (await read<TransferList>(await get(live, `${PATH}${query}`))).data;
    const key = '{place} opens giant solar farm';

    expect(await listed()).toMatchObject({ ownerPlace: null, ideas: [], videosChecked: 0 });
    await real.crawl('@handleC', 1, () => {});

    const found = await listed('?channel=%40handleC');
    expect(found.ownerPlace).toEqual({ key: 'PE', name: 'Peru', source: 'titles' });
    expect(found.ideas.map((idea) => [idea.key, idea.verdict.status, idea.saved])).toEqual([
      [key, 'open', false],
    ]);
    expect(found.ideas[0]?.versions.map((version) => version.place?.name)).toEqual([
      'Kenya',
      'Chile',
    ]);

    // Told the owner makes videos for Chile, the same idea has a weak version there.
    expect((await listed('?place=Chile')).ideas[0]?.verdict.status).toBe('weak');

    expect((await post(live, SAVE, { key: 'no such idea here', saved: true })).status).toBe(404);
    expect((await post(live, SAVE, { key, saved: true })).status).toBe(200);
    expect((await listed()).ideas.map((idea) => idea.saved)).toEqual([true]);

    expect((await post(live, SAVE, { key, saved: false })).status).toBe(200);
    expect((await listed()).ideas.map((idea) => idea.saved)).toEqual([false]);
    real.close();
  });
});
