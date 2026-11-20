import {
  InnertubeSource,
  RateLimiter,
  SqliteChannelRepo,
  SqliteEdgeRepo,
  SqliteMapRepo,
  SqliteVideoRepo,
  crawlMap,
  loadMapSnapshot,
  openDatabase,
  parseChannelRef,
  transactionRunner,
  type Config,
  type YouTubeSource,
} from '@jgtube/core';
import type { Engine } from './app';

const REQUEST_TIMEOUT_MS = 30_000;

export interface RunningEngine extends Engine {
  close(): void;
}

/** Wires the API to the real store and to YouTube. */
export function createEngine(config: Config): RunningEngine {
  const db = openDatabase(config.dbPath);
  const repos = {
    channels: new SqliteChannelRepo(db),
    videos: new SqliteVideoRepo(db),
    edges: new SqliteEdgeRepo(db),
    maps: new SqliteMapRepo(db),
  };
  // Created on the first crawl, so stored maps can be read with no network at all.
  let source: Promise<YouTubeSource> | null = null;
  const getSource = (): Promise<YouTubeSource> => {
    source ??= InnertubeSource.create({
      region: config.region,
      limiter: new RateLimiter({
        concurrency: 2,
        minDelayMs: 300,
        maxDelayMs: 600,
        maxRetries: 3,
        baseBackoffMs: 2000,
        taskTimeoutMs: REQUEST_TIMEOUT_MS,
      }),
    });
    return source;
  };

  return {
    findSnapshot(channel) {
      const ref = parseChannelRef(channel);
      const stored =
        ref.kind === 'id'
          ? repos.channels.findById(ref.id)
          : repos.channels.findByHandle(ref.handle);
      return stored ? loadMapSnapshot(repos, stored.id, new Date()) : null;
    },

    async crawl(channel, depth, onProgress) {
      const result = await crawlMap(
        {
          ...repos,
          source: await getSource(),
          transact: transactionRunner(db),
          region: config.region,
          now: () => new Date(),
        },
        channel,
        { depth, onProgress },
      );
      return { centerChannelId: result.centerChannelId, warnings: result.warnings };
    },

    close() {
      db.close();
    },
  };
}
