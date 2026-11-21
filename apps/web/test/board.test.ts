import type { BoardChannel, ScoredBoardVideo, ThumbnailBoard } from '@jgtube/core';
import { describe, expect, test } from 'vitest';
import { ApiError, createApi } from '../src/lib/api';
import {
  BOARD_MODES,
  boardTotals,
  describeHitRate,
  describeOwn,
  describeSaved,
  scoreTone,
} from '../src/lib/board';
import { logoUrl } from '../src/lib/format';

const cid = (n: number) => `UC${String(n).padStart(22, '0')}`;

const video = (n: number, score: number): ScoredBoardVideo => ({
  videoId: `video${String(n).padStart(6, '0')}`,
  title: `Video ${n}`,
  views: 1000 * n,
  score,
  publishedRaw: `${n}d ago`,
  ageDays: n,
  durationSeconds: 600,
});

const channel = (n: number, overrides: Partial<BoardChannel> = {}): BoardChannel => ({
  id: cid(n),
  title: `Channel ${n}`,
  subscribers: 1000 * n,
  winners: [video(1, 30), video(2, 8)],
  ordinary: [video(3, 0.8)],
  winnerCount: 12,
  scoredCount: 38,
  ...overrides,
});

const board = (channels: readonly BoardChannel[]): ThumbnailBoard => ({
  mapId: 7,
  center: { id: cid(0), title: 'Centre', subscribers: null, videos: [] },
  channels,
  winnerMinScore: 2,
  ordinaryMaxScore: 1.2,
});

describe('thumbnail board', () => {
  test('offers winners alone or winners next to ordinary videos', () => {
    expect(BOARD_MODES.map((mode) => mode.id)).toEqual(['compare', 'winners']);
  });

  test('counts what the board shows', () => {
    const totals = boardTotals(
      board([channel(1), channel(2, { winners: [], ordinary: [] }), channel(3)]),
    );

    expect(totals).toEqual({ channels: 3, winners: 4, ordinary: 2 });
  });

  test('counts nothing on an empty board', () => {
    expect(boardTotals(board([]))).toEqual({ channels: 0, winners: 0, ordinary: 0 });
  });

  test('says how often a channel’s videos take off', () => {
    expect(describeHitRate(channel(1))).toBe('12 of 38 videos took off');
    expect(describeHitRate(channel(1, { winnerCount: 1, scoredCount: 1 }))).toBe(
      '1 of 1 video took off',
    );
  });

  test('says so when a channel has too few videos to judge', () => {
    expect(describeHitRate(channel(1, { winnerCount: 0, scoredCount: 0 }))).toBe(
      'Too few videos to judge yet',
    );
  });

  test.each([
    [0, 'Centre'],
    [1, 'Centre · your newest video'],
    [3, 'Centre · your 3 newest videos'],
  ])('labels the owner’s own row when it holds %d videos', (count, label) => {
    const videos = Array.from({ length: count }, (_, index) => video(index + 1, 1));

    expect(describeOwn({ ...board([]).center, videos })).toBe(label);
  });

  test.each([
    [30, 'winner'],
    [2, 'winner'],
    [1.99, 'plain'],
    [0.4, 'plain'],
    [null, 'none'],
  ] as const)('marks a score of %j as %s', (score, tone) => {
    expect(scoreTone(score, board([]))).toBe(tone);
  });
});

describe('api.thumbnailBoard', () => {
  const respond = (status: number, body: unknown) => async () =>
    new Response(JSON.stringify(body), { status });

  test('returns the board from a successful envelope', async () => {
    const found = board([channel(1)]);
    const api = createApi(respond(200, { success: true, data: found, error: null }));

    await expect(api.thumbnailBoard('@x')).resolves.toEqual(found);
  });

  test('returns null when no map exists yet', async () => {
    const api = createApi(respond(404, { success: false, data: null, error: 'No map' }));

    await expect(api.thumbnailBoard('@x')).resolves.toBeNull();
  });

  test('raises the server message for other failures', async () => {
    const api = createApi(
      respond(400, { success: false, data: null, error: 'Not a valid channel' }),
    );

    await expect(api.thumbnailBoard('bad')).rejects.toThrow(
      new ApiError('Not a valid channel', 400),
    );
  });

  test('encodes the channel in the address', async () => {
    const urls: string[] = [];
    const api = createApi(async (url) => {
      urls.push(url);
      return new Response(JSON.stringify({ success: true, data: {}, error: null }));
    });

    await api.thumbnailBoard('@a b');

    expect(urls[0]).toBe('/api/maps/latest/thumbnails?channel=%40a%20b');
  });
});

describe('downloading a channel’s thumbnails', () => {
  const saved = {
    channel: cid(1),
    folder: 'C:\\Users\\owner\\jgtube\\downloads\\thumbnails\\UC1',
    indexFile: 'C:\\Users\\owner\\jgtube\\downloads\\thumbnails\\UC1\\index.json',
    total: 9,
    saved: 9,
    alreadyThere: 0,
    failed: 0,
  };

  test('asks the server to save them and returns where they went', async () => {
    const calls: Array<{ path: string; init?: RequestInit }> = [];
    const api = createApi(async (path, init) => {
      calls.push({ path, ...(init ? { init } : {}) });
      return Response.json({ success: true, data: saved, error: null, meta: null });
    });

    expect(await api.downloadThumbnails(cid(1))).toEqual(saved);
    expect(calls[0]?.path).toBe('/api/thumbnails/download');
    expect(calls[0]?.init?.method).toBe('POST');
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ channel: cid(1) });
  });

  test('raises the server’s reason when they could not be saved', async () => {
    const api = createApi(async () =>
      Response.json(
        { success: false, data: null, error: 'That channel has not been read yet', meta: null },
        { status: 404 },
      ),
    );

    await expect(api.downloadThumbnails(cid(1))).rejects.toThrow(
      new ApiError('That channel has not been read yet', 404),
    );
  });

  test('tells the owner where the files are', () => {
    expect(describeSaved(saved)).toBe(
      '9 thumbnails saved in C:\\Users\\owner\\jgtube\\downloads\\thumbnails\\UC1, with an index.json saying what each one is.',
    );
    expect(describeSaved({ ...saved, total: 1, saved: 1 })).toMatch(/^1 thumbnail saved in /);
  });

  test('says which were already there and which could not be fetched', () => {
    expect(describeSaved({ ...saved, saved: 2, alreadyThere: 7 })).toMatch(
      /index\.json saying what each one is\. 7 were already there\.$/,
    );
    expect(describeSaved({ ...saved, total: 8, saved: 8, failed: 1 })).toMatch(
      /1 could not be fetched; press again to try it once more\.$/,
    );
    expect(describeSaved({ ...saved, total: 9, saved: 0, alreadyThere: 9 })).toMatch(
      /All 9 were already there\.$/,
    );
  });

  test('says so when a channel has nothing to save', () => {
    expect(describeSaved({ ...saved, total: 0, saved: 0 })).toBe(
      'This channel has no winning or ordinary videos yet, so there are no thumbnails to save.',
    );
    expect(describeSaved({ ...saved, total: 0, saved: 0, failed: 3 })).toBe(
      'None of the 3 thumbnails could be fetched. Press again to try once more.',
    );
  });
});

describe('logoUrl', () => {
  test('shows a logo only from the host channel images are served from', () => {
    const logo = 'https://yt3.googleusercontent.com/abc=s72-c-k-c0x00ffffff-no-rj';

    expect(logoUrl(logo)).toBe(logo);
    expect(logoUrl('https://evil.example/logo.png')).toBeNull();
    expect(logoUrl('http://yt3.googleusercontent.com/abc')).toBeNull();
    expect(logoUrl('https://yt3.googleusercontent.com.evil.example/abc')).toBeNull();
    expect(logoUrl('javascript:alert(1)')).toBeNull();
    expect(logoUrl(null)).toBeNull();
  });
});
