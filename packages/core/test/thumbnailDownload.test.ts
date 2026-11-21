import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { openDatabase } from '../src/db/sqlite';
import { DOWNLOADS_FOLDER, downloadsRoot, pathInside } from '../src/downloads/folder';
import { saveChannelThumbnails, type ThumbnailDownloadDeps } from '../src/downloads/thumbnails';
import { SqliteChannelRepo } from '../src/repos/sqliteChannelRepo';
import { SqliteVideoRepo } from '../src/repos/sqliteVideoRepo';
import type { FetchImage } from '../src/sources/images';
import type { StorableVideo } from '../src/sources/types';

const NOW = new Date('2026-11-20T12:00:00Z');
const DAY_MS = 86_400_000;
const CHANNEL = `UC${'a'.repeat(22)}`;
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const vid = (n: number) => `video${String(n).padStart(6, '0')}`;

const video = (n: number, views: number, daysAgo: number): StorableVideo => ({
  id: vid(n),
  channelId: CHANNEL,
  title: `Video ${n}`,
  views,
  durationSeconds: 600,
  published: { date: new Date(NOW.getTime() - daysAgo * DAY_MS), precision: 'day', raw: 'x' },
});

let root: string;
let deps: ThumbnailDownloadDeps;
let fetched: string[];
let answer: (url: string) => Response;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'jgtube-downloads-'));
  const db = openDatabase(':memory:');
  const channels = new SqliteChannelRepo(db);
  const videos = new SqliteVideoRepo(db);
  channels.upsert(
    {
      id: CHANNEL,
      title: 'Some Bakery',
      handle: 'somebakery',
      subscribers: 900,
      subscribersHidden: false,
      videoCount: 6,
    },
    NOW,
  );
  // Two far above the channel's usual thousand views, four at it.
  videos.upsertMany(
    [
      video(1, 50_000, 10),
      video(2, 9000, 12),
      video(3, 1000, 14),
      video(4, 1000, 16),
      video(5, 1000, 18),
      video(6, 1000, 20),
    ],
    NOW,
  );
  fetched = [];
  answer = () => new Response(JPEG, { headers: { 'content-type': 'image/jpeg' } });
  const fetchImage: FetchImage = async (url) => {
    fetched.push(url);
    return answer(url);
  };
  deps = { channels, videos, now: () => NOW, fetchImage };
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('saveChannelThumbnails', () => {
  test('saves a channel’s winners and ordinary videos as files, named by video id', async () => {
    const result = await saveChannelThumbnails(deps, CHANNEL, root);

    const folder = join(root, 'thumbnails', CHANNEL);
    expect(result).toMatchObject({
      channelId: CHANNEL,
      channelTitle: 'Some Bakery',
      folder,
      saved: 6,
      alreadyThere: 0,
      failed: [],
    });
    expect(readdirSync(folder).sort()).toEqual([
      'index.json',
      ...[1, 2, 3, 4, 5, 6].map((n) => `${vid(n)}.jpg`),
    ]);
    expect(new Uint8Array(readFileSync(join(folder, `${vid(1)}.jpg`)))).toEqual(JPEG);
    expect(fetched[0]).toBe(`https://i.ytimg.com/vi/${vid(1)}/hqdefault.jpg`);
  });

  test('writes an index saying what each picture is', async () => {
    const result = await saveChannelThumbnails(deps, CHANNEL, root);

    const index = JSON.parse(readFileSync(result?.indexFile ?? '', 'utf8')) as {
      images: Array<Record<string, unknown>>;
    };
    expect(index).toMatchObject({
      channelId: CHANNEL,
      channelTitle: 'Some Bakery',
      savedAt: '2026-11-20T12:00:00.000Z',
      winnerMinScore: 2,
      ordinaryMaxScore: 1.2,
    });
    expect(index.images[0]).toMatchObject({
      videoId: vid(1),
      title: 'Video 1',
      views: 50_000,
      group: 'winner',
      file: `${vid(1)}.jpg`,
    });
    expect(index.images[0]?.['score']).toBeGreaterThan(10);
    expect(index.images.map((image) => image['group'])).toEqual([
      'winner',
      'winner',
      'ordinary',
      'ordinary',
      'ordinary',
      'ordinary',
    ]);
  });

  test('does not fetch a picture that is already in the folder', async () => {
    await saveChannelThumbnails(deps, CHANNEL, root);
    fetched = [];

    const again = await saveChannelThumbnails(deps, CHANNEL, root);

    expect(again).toMatchObject({ saved: 0, alreadyThere: 6 });
    expect(fetched).toEqual([]);
    expect(again?.images).toHaveLength(6);
  });

  test('reports a picture that could not be fetched and leaves it out of the index', async () => {
    answer = (url) =>
      url.includes(vid(2))
        ? new Response('', { status: 404 })
        : new Response(JPEG, { headers: { 'content-type': 'image/jpeg' } });

    const result = await saveChannelThumbnails(deps, CHANNEL, root);

    expect(result).toMatchObject({
      saved: 5,
      failed: [{ videoId: vid(2), reason: 'YouTube has no thumbnail for it (status 404)' }],
    });
    expect(result?.images.map((image) => image.videoId)).not.toContain(vid(2));
    expect(readdirSync(result?.folder ?? '')).not.toContain(`${vid(2)}.jpg`);
  });

  test('saves fewer when asked to', async () => {
    const result = await saveChannelThumbnails(deps, CHANNEL, root, { perGroup: 1 });

    expect(result?.images.map((image) => [image.videoId, image.group])).toEqual([
      [vid(1), 'winner'],
      [vid(3), 'ordinary'],
    ]);
  });

  test('has nothing to save for a channel that is not stored, and refuses a bad id', async () => {
    expect(await saveChannelThumbnails(deps, `UC${'z'.repeat(22)}`, root)).toBeNull();
    await expect(saveChannelThumbnails(deps, '../../outside', root)).rejects.toThrow(/channel id/);
    expect(readdirSync(root)).toEqual([]);
  });

  test('replaces an empty file left by a write that was cut short', async () => {
    const first = await saveChannelThumbnails(deps, CHANNEL, root);
    writeFileSync(join(first?.folder ?? '', `${vid(1)}.jpg`), '');

    const again = await saveChannelThumbnails(deps, CHANNEL, root);

    expect(again).toMatchObject({ saved: 1, alreadyThere: 5 });
  });
});

describe('the downloads folder', () => {
  test('is "downloads" beside the store unless one is named', () => {
    const storePath = join(root, 'research', 'jgtube.db');

    expect(downloadsRoot({ dbPath: storePath })).toBe(join(root, 'research', DOWNLOADS_FOLDER));
    expect(downloadsRoot({ dbPath: storePath, downloadsPath: join(root, 'elsewhere') })).toBe(
      join(root, 'elsewhere'),
    );
    expect(downloadsRoot({ dbPath: 'jgtube.db' })).toBe(resolve('downloads'));
  });

  test('must be named for a store that is only in memory', () => {
    expect(() => downloadsRoot({ dbPath: ':memory:' })).toThrow(/JGTUBE_DOWNLOADS_PATH/);
    expect(downloadsRoot({ dbPath: ':memory:', downloadsPath: root })).toBe(root);
  });

  test('never yields a path outside itself', () => {
    expect(pathInside(root, 'thumbnails', CHANNEL)).toBe(join(root, 'thumbnails', CHANNEL));
    expect(() => pathInside(root, '..', 'elsewhere')).toThrow(/outside the downloads folder/);
    expect(() => pathInside(root, 'a', '..', '..', 'b')).toThrow(/outside/);
    expect(() => pathInside(root, `${sep}etc${sep}passwd`)).toThrow(/outside/);
    expect(() => pathInside(root)).toThrow(/outside/);
  });
});
