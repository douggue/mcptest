import {
  InnertubeSource,
  RateLimiter,
  SqliteChannelRepo,
  SqliteEdgeRepo,
  SqliteFactsRepo,
  SqliteMapRepo,
  SqliteRefreshRepo,
  SqliteVideoRepo,
  SqliteWatchlistRepo,
  crawlMap,
  discoverByKeyword,
  fetchChannelFacts,
  fillNicheFacts,
  loadMapSnapshot,
  loadNicheList,
  loadRefreshStatus,
  loadSameTopicList,
  loadThumbnailBoard,
  openDatabase,
  parseChannelRef,
  refreshStalest,
  searchRecentVideos,
  transactionRunner,
  type ChannelFacts,
  type Config,
  type FactsOutcome,
  type SearchHit,
  type StoredChannel,
  type YouTubeSource,
} from '@jgtube/core';
import type { Engine } from './app';
import { cleanMessage } from './jobs';

const REQUEST_TIMEOUT_MS = 30_000;

export interface RunningEngine extends Engine {
  close(): void;
}

export interface EngineOptions {
  /** Replaces the connection to YouTube; used by tests. */
  readonly createSource?: () => Promise<YouTubeSource>;
  readonly now?: () => Date;
  /** Replaces the official API's search; used by tests. */
  readonly search?: (
    query: string,
    options: { readonly publishedAfter: Date },
  ) => Promise<readonly SearchHit[]>;
  /** Replaces the official API's channel facts; used by tests. It is only called when a key is set. */
  readonly fetchFacts?: (channelIds: readonly string[]) => Promise<readonly ChannelFacts[]>;
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
    runs: new SqliteRefreshRepo(db),
    facts: new SqliteFactsRepo(db),
  };
  // Created on the first crawl, so stored maps can be read with no network at all.
  let source: Promise<YouTubeSource> | null = null;
  /**
   * A source that connects on first use. A refresh that finds nothing due then
   * makes no request at all, which matters to a timer that fires every few hours.
   */
  const connected = (): Promise<YouTubeSource> => (source ??= createSource());
  const lazySource: YouTubeSource = {
    resolveChannelId: async (handle) => (await connected()).resolveChannelId(handle),
    fetchChannel: async (channelId, maxVideos) =>
      (await connected()).fetchChannel(channelId, maxVideos),
    getSidebar: async (videoId) => (await connected()).getSidebar(videoId),
  };
  /**
   * Reads the account dates and countries the niche list lacks, from the
   * official API. Without the owner's key there is nothing to ask with, so it
   * does nothing and says nothing. Error text goes to the browser, so it is cleaned.
   */
  const fillFacts = async (): Promise<FactsOutcome | null> => {
    const apiKey = config.youtubeApiKey;
    if (apiKey === undefined) return null;
    const fetchFacts = options.fetchFacts ?? ((ids) => fetchChannelFacts(ids, { apiKey }));
    const outcome = await fillNicheFacts({ ...repos, fetchFacts }, now());
    return { ...outcome, problem: outcome.problem === null ? null : cleanMessage(outcome.problem) };
  };
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

    findSameTopic(channel) {
      const stored = findStored(channel);
      return stored ? loadSameTopicList(repos, stored.id, now()) : null;
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

    setCompetitorStatus(centerChannelId, channelId, status) {
      const map = repos.maps.latestForCenter(centerChannelId);
      // Only channels on the map can be kept or removed, and never the centre itself.
      const onMap = map?.members.some((m) => m.channelId === channelId && m.steps > 0) ?? false;
      if (!onMap) return false;
      if (status === 'kept') {
        repos.maps.setKept(centerChannelId, channelId, true, now());
      } else if (status === 'removed') {
        repos.maps.setRemoved(centerChannelId, channelId, true, now());
      } else {
        // Making a choice withdraws the other one; 'auto' withdraws whichever was made.
        repos.maps.setRemoved(centerChannelId, channelId, false, now());
        repos.maps.setKept(centerChannelId, channelId, false, now());
      }
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

    async refresh(onProgress, maxChannels) {
      const result = await refreshStalest(
        { ...repos, source: lazySource, transact: transactionRunner(db), now },
        { onProgress, ...(maxChannels ? { maxChannels } : {}) },
      );
      const facts = await fillFacts();
      return {
        refreshed: result.refreshed.length,
        failed: result.failed.length,
        notAttempted: result.notAttempted,
        stoppedEarly: result.stoppedEarly,
        stillDue: result.stillDue,
        factsAdded: facts?.added ?? 0,
        factsProblem: facts?.problem ?? null,
      };
    },

    refreshStatus() {
      return { ...loadRefreshStatus(repos, now()), everyHours: config.refreshHours ?? null };
    },

    canDiscover() {
      return config.youtubeApiKey !== undefined;
    },

    async discover(keyword) {
      const apiKey = config.youtubeApiKey;
      if (apiKey === undefined) throw new Error('Keyword search needs a YouTube API key');
      source ??= createSource();
      const found = await discoverByKeyword(
        {
          channels: repos.channels,
          videos: repos.videos,
          source: await source,
          transact: transactionRunner(db),
          now,
          search:
            options.search ??
            ((query, { publishedAfter }) => searchRecentVideos(query, { apiKey, publishedAfter })),
        },
        keyword,
      );
      return { ...found, facts: await fillFacts() };
    },

    close() {
      db.close();
    },
  };
}
