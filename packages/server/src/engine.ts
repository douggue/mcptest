import {
  InnertubeSource,
  RateLimiter,
  SqliteChannelRepo,
  SqliteEdgeRepo,
  SqliteMapRepo,
  SqliteVideoRepo,
  SqliteWatchlistRepo,
  crawlMap,
  loadMapSnapshot,
  loadNicheList,
  loadThumbnailBoard,
  openDatabase,
  parseChannelRef,
  transactionRunner,
  type Config,
  type StoredChannel,
  type YouTubeSource,
} from '@jgtube/core';
import type { Engine } from './app';

const REQUEST_TIMEOUT_MS = 30_000;

export interface RunningEngine extends Engine {
  close(): void;
}

export interface EngineOptions {
  /** Replaces the connection to YouTube; used by tests. */
  readonly createSource?: () => Promise<YouTubeSource>;
  readonly now?: () => Date;
}

function youtubeSource(config: Config): Promise<YouTubeSource> {
  return InnertubeSource.create({
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
}

/** Wires the API to the store and to YouTube. */
export function createEngine(config: Config, options: EngineOptions = {}): RunningEngine {
  const db = openDatabase(config.dbPath);
  const now = options.now ?? (() => new Date());
  const createSource = options.createSource ?? (() => youtubeSource(config));
  const repos = {
    channels: new SqliteChannelRepo(db),
    videos: new SqliteVideoRepo(db),
    edges: new SqliteEdgeRepo(db),
    maps: new SqliteMapRepo(db),
    watchlist: new SqliteWatchlistRepo(db),
  };
  // Created on the first crawl, so stored maps can be read with no network at all.
  let source: Promise<YouTubeSource> | null = null;
  /** The stored channel a handle, link or id refers to; reads the store only. */
  const findStored = (channel: string): StoredChannel | null => {
    const ref = parseChannelRef(channel);
    return ref.kind === 'id'
      ? repos.channels.findById(ref.id)
      : repos.channels.findByHandle(ref.handle);
  };

  return {
    findSnapshot(channel) {
      const stored = findStored(channel);
      return stored ? loadMapSnapshot(repos, stored.id, now()) : null;
    },

    findThumbnailBoard(channel) {
      const stored = findStored(channel);
      return stored ? loadThumbnailBoard(repos, stored.id, now()) : null;
    },

    async crawl(channel, depth, onProgress, choices = {}) {
      const { model, maxChannels } = choices;
      source ??= createSource();
      const result = await crawlMap(
        {
          ...repos,
          source: await source,
          transact: transactionRunner(db),
          region: config.region,
          now,
        },
        channel,
        {
          depth,
          onProgress,
          ...(model ? { model } : {}),
          ...(maxChannels ? { maxChannels } : {}),
        },
      );
      return { centerChannelId: result.centerChannelId, warnings: result.warnings };
    },

    setCompetitorRemoved(centerChannelId, channelId, removed) {
      const map = repos.maps.latestForCenter(centerChannelId);
      // Only channels on the map can be removed, and never the centre itself.
      const onMap = map?.members.some((m) => m.channelId === channelId && m.steps > 0) ?? false;
      if (!onMap) return false;
      repos.maps.setRemoved(centerChannelId, channelId, removed, now());
      return true;
    },

    listNiches() {
      return loadNicheList(repos, now());
    },

    setNicheWatched(channelId, watched) {
      // Only a channel some crawl has read can be watched.
      if (!repos.channels.findById(channelId)) return false;
      repos.watchlist.setWatched(channelId, watched, now());
      return true;
    },

    close() {
      db.close();
    },
  };
}
