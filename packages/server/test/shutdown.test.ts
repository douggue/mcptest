import {
  SqliteLeaseRepo,
  openDatabase,
  type ChannelSnapshot,
  type YouTubeSource,
} from '@jgtube/core';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import type { ClaudeRunResult } from '../src/claudeRunner';
import { createEngine, type EngineOptions, type RunningEngine } from '../src/engine';
import { CHANNEL_ID } from './support';

const NOW = new Date('2026-11-20T12:00:00Z');
const DAY_MS = 86_400_000;
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const snapshotOf = (channelId: string): ChannelSnapshot => ({
  channel: {
    id: channelId,
    title: 'Channel',
    handle: 'channel',
    subscribers: 1000,
    subscribersHidden: false,
    videoCount: 1,
  },
  videos: [
    {
      id: 'DDDDDDDDDD1',
      channelId,
      title: 'How it was built',
      views: 5000,
      durationSeconds: 600,
      published: { date: new Date(NOW.getTime() - DAY_MS), precision: 'day', raw: '1d ago' },
    },
  ],
});

let folder: string;
let dbPath: string;
let engine: RunningEngine;
/** Channel reads asked of YouTube that the test has not answered yet. */
let pendingReads: Array<(snapshot: ChannelSnapshot) => void>;
let readsAsked: number;

const source: YouTubeSource = {
  resolveChannelId: async () => CHANNEL_ID,
  fetchVideoPage: async () => {
    throw new Error('fetchVideoPage is not used in this test');
  },
  getSidebar: async () => [],
  fetchChannel: (channelId) => {
    readsAsked += 1;
    return new Promise((resolve) => {
      pendingReads.push(() => resolve(snapshotOf(channelId)));
    });
  },
};

function start(options: EngineOptions = {}): RunningEngine {
  engine = createEngine(
    { dbPath, region: 'US' },
    { now: () => NOW, createSource: async () => source, ...options },
  );
  return engine;
}

/** Who holds the lease, as another program with the store open sees it. */
function leaseHolder(): string | null {
  const other = openDatabase(dbPath);
  try {
    return new SqliteLeaseRepo(other).holder(NOW);
  } finally {
    other.close();
  }
}

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'jgtube-shutdown-'));
  dbPath = join(folder, 'store.db');
  pendingReads = [];
  readsAsked = 0;
});

afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
});

describe('shutting the engine down', () => {
  test('closes the store at once when nothing is running', async () => {
    start();

    await engine.shutdown();

    expect(() => engine.listNiches()).toThrow();
  });

  test('stops Claude and waits for the analysis to end before closing the store', async () => {
    const signals: AbortSignal[] = [];
    start({
      storePath: dbPath,
      runClaude: (_request, signal) => {
        signals.push(signal);
        return new Promise<ClaudeRunResult>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('stopped')));
        });
      },
    });
    const analysis = engine.analyse('thumbnails', CHANNEL_ID);
    await settle();

    await engine.shutdown();

    expect(signals.map((signal) => signal.aborted)).toEqual([true]);
    await expect(analysis).rejects.toThrow('stopped');
  });

  test('lets a crawl finish the request it is on, asks for no more, and only then closes the store', async () => {
    start();
    const crawl = engine.crawl(CHANNEL_ID, 1, () => {}).catch((error: unknown) => error as Error);
    await settle();
    expect(readsAsked).toBe(1);

    const closed = engine.shutdown();
    await settle();
    // The store is still open: the read under way can be stored when it comes back.
    expect(() => engine.listNiches()).not.toThrow();
    pendingReads.forEach((answer) => answer(snapshotOf(CHANNEL_ID)));
    await closed;

    const outcome = await crawl;
    expect(readsAsked).toBe(1);
    expect(String(outcome instanceof Error ? outcome.message : '')).not.toMatch(/not open/);
    expect(leaseHolder()).toBeNull();
    expect(() => engine.listNiches()).toThrow();
  });

  test('gives up waiting after a while, and gives the lease back so a restart is not refused', async () => {
    start({ closeGraceMs: 20 });
    const crawl = engine.crawl(CHANNEL_ID, 1, () => {}).catch((error: unknown) => error as Error);
    await settle();
    expect(leaseHolder()).not.toBeNull();

    await engine.shutdown();

    expect(leaseHolder()).toBeNull();
    pendingReads.forEach((answer) => answer(snapshotOf(CHANNEL_ID)));
    expect(await crawl).toBeInstanceOf(Error);
  });

  test('starts nothing new once it has begun', async () => {
    start({ storePath: dbPath, runClaude: async () => ({ text: 'late', turns: 1 }) });
    await engine.shutdown();

    await expect(engine.crawl(CHANNEL_ID, 1, () => {})).rejects.toThrow(/closing/);
    await expect(engine.refresh(() => {})).rejects.toThrow(/closing/);
    await expect(engine.analyse('thumbnails', CHANNEL_ID)).rejects.toThrow(/closing/);
    expect(readsAsked).toBe(0);
  });

  test('can be asked twice', async () => {
    start();

    await Promise.all([engine.shutdown(), engine.shutdown()]);
    await engine.shutdown();

    expect(() => engine.listNiches()).toThrow();
  });
});
