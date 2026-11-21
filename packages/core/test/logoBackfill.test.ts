import { describe, expect, test } from 'vitest';
import {
  LOGO_BACKFILL_MAX_FAILURES_IN_A_ROW,
  backfillLogos,
  channelsMissingLogos,
  type LogoProgress,
} from '../src/channel/logoBackfill';
import type { MapSnapshot } from '../src/map/snapshot';
import type { BrandRepo, StoredBrand } from '../src/repos/types';
import type { ChannelBrand, ChannelSnapshot } from '../src/sources/types';

const NOW = new Date('2026-11-21T12:00:00Z');
const id = (n: number): string => `UC${String(n).padStart(22, '0')}`;
const LOGO = 'https://yt3.googleusercontent.com/logo=s88';

const brandWith = (url: string | null): ChannelBrand => ({
  description: null,
  avatar: url === null ? [] : [{ url, width: 88, height: 88 }],
  banner: [],
  keywords: [],
  links: [],
});

/** A brand store in memory that remembers what was saved. */
function memoryBrands(known: readonly string[] = []): BrandRepo & { saved: string[] } {
  const stored = new Map<string, StoredBrand>(
    known.map((channelId) => [channelId, { channelId, ...brandWith(LOGO), fetchedAt: NOW }]),
  );
  const saved: string[] = [];
  return {
    saved,
    find: (channelId) => stored.get(channelId) ?? null,
    save: (channelId, brand, fetchedAt) => {
      saved.push(channelId);
      stored.set(channelId, { channelId, ...brand, fetchedAt });
    },
  };
}

const channelOf = (channelId: string, peer: boolean, removed = false) =>
  ({ id: channelId, title: channelId, peer, removed }) as MapSnapshot['channels'][number];

const snapshotOf = (channels: MapSnapshot['channels']): MapSnapshot =>
  ({ center: { id: id(0), title: 'Centre' }, channels }) as MapSnapshot;

const pageOf = (channelId: string, brand?: ChannelBrand): ChannelSnapshot => ({
  channel: {
    id: channelId,
    title: channelId,
    handle: null,
    subscribers: null,
    subscribersHidden: true,
    videoCount: null,
  },
  videos: [],
  ...(brand ? { brand } : {}),
});

describe('channelsMissingLogos', () => {
  test('lists the centre first, then the look-alikes, then the rest', () => {
    const snapshot = snapshotOf([
      channelOf(id(1), false),
      channelOf(id(2), true),
      channelOf(id(3), false),
      channelOf(id(4), true),
    ]);

    const missing = channelsMissingLogos(snapshot, memoryBrands());

    expect(missing).toEqual([id(0), id(2), id(4), id(1), id(3)]);
  });

  test('leaves out a channel whose branding was already read, logo or not', () => {
    const snapshot = snapshotOf([channelOf(id(1), true), channelOf(id(2), true)]);

    const missing = channelsMissingLogos(snapshot, memoryBrands([id(0), id(2)]));

    expect(missing).toEqual([id(1)]);
  });

  test('puts a look-alike the owner removed with the rest', () => {
    const snapshot = snapshotOf([channelOf(id(1), true, true), channelOf(id(2), true)]);

    const missing = channelsMissingLogos(snapshot, memoryBrands([id(0)]));

    expect(missing).toEqual([id(2), id(1)]);
  });
});

describe('backfillLogos', () => {
  test('reads each channel page without its videos and stores what it shows', async () => {
    const brands = memoryBrands();
    const asked: Array<[string, number]> = [];
    const progress: LogoProgress[] = [];

    const outcome = await backfillLogos(
      {
        brands,
        now: () => NOW,
        source: {
          fetchChannel: async (channelId, maxVideos) => {
            asked.push([channelId, maxVideos]);
            return pageOf(channelId, brandWith(LOGO));
          },
        },
      },
      [id(1), id(2)],
      { onProgress: (step) => progress.push(step) },
    );

    expect(asked).toEqual([
      [id(1), 0],
      [id(2), 0],
    ]);
    expect(brands.saved).toEqual([id(1), id(2)]);
    expect(outcome).toEqual({ asked: 2, found: 2, failed: 0, stoppedEarly: false });
    expect(progress.at(-1)).toEqual({
      done: 2,
      total: 2,
      logos: [
        { channelId: id(1), logoUrl: LOGO },
        { channelId: id(2), logoUrl: LOGO },
      ],
    });
  });

  test('records a channel with no logo as read, so it is not asked for again', async () => {
    const brands = memoryBrands();

    const outcome = await backfillLogos(
      {
        brands,
        now: () => NOW,
        source: { fetchChannel: async (channelId) => pageOf(channelId) },
      },
      [id(1)],
    );

    expect(brands.find(id(1))?.avatar).toEqual([]);
    expect(outcome).toEqual({ asked: 1, found: 0, failed: 0, stoppedEarly: false });
  });

  test('carries on past a channel that cannot be read', async () => {
    const brands = memoryBrands();

    const outcome = await backfillLogos(
      {
        brands,
        now: () => NOW,
        source: {
          fetchChannel: async (channelId) => {
            if (channelId === id(1)) throw new Error('gone');
            return pageOf(channelId, brandWith(LOGO));
          },
        },
      },
      [id(1), id(2)],
    );

    expect(brands.saved).toEqual([id(2)]);
    expect(outcome).toEqual({ asked: 2, found: 1, failed: 1, stoppedEarly: false });
  });

  test('stops after several failures in a row', async () => {
    const ids = Array.from({ length: LOGO_BACKFILL_MAX_FAILURES_IN_A_ROW + 2 }, (_, n) => id(n));
    let calls = 0;

    const outcome = await backfillLogos(
      {
        brands: memoryBrands(),
        now: () => NOW,
        source: {
          fetchChannel: async () => {
            calls += 1;
            throw new Error('refused');
          },
        },
      },
      ids,
    );

    expect(calls).toBe(LOGO_BACKFILL_MAX_FAILURES_IN_A_ROW);
    expect(outcome.stoppedEarly).toBe(true);
    expect(outcome.failed).toBe(LOGO_BACKFILL_MAX_FAILURES_IN_A_ROW);
  });

  test('stops before the next channel when told to', async () => {
    let calls = 0;

    const outcome = await backfillLogos(
      {
        brands: memoryBrands(),
        now: () => NOW,
        source: {
          fetchChannel: async (channelId) => {
            calls += 1;
            return pageOf(channelId, brandWith(LOGO));
          },
        },
      },
      [id(1), id(2), id(3)],
      { shouldStop: () => calls >= 1 },
    );

    expect(calls).toBe(1);
    expect(outcome).toEqual({ asked: 1, found: 1, failed: 0, stoppedEarly: true });
  });
});
