import {
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
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analysisRequest } from './analyses';
import type { Engine } from './app';
import {
  runClaude,
  spawnClaude,
  type ClaudeRunRequest,
  type ClaudeRunResult,
} from './claudeRunner';
import { connectOnUse, onceUntilItWorks, youtubeSource } from './connection';
import { cleanMessage } from './jobs';

const IN_MEMORY = ':memory:';
/** The Jgtube folder: the connector Claude is given lives under it. */
const PROJECT_ROOT = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
/** Prefix of the private folder Claude starts in. */
const CLAUDE_WORK_PREFIX = join(tmpdir(), 'jgtube-claude-');

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
  /** Replaces running Claude Code; used by tests. */
  readonly runClaude?: (request: ClaudeRunRequest) => Promise<ClaudeRunResult>;
  /** The store as the connector should open it; defaults to the configured path made absolute. */
  readonly storePath?: string;
  /** Replaces the official API's channel facts; used by tests. It is only called when a key is set. */
  readonly fetchFacts?: (channelIds: readonly string[]) => Promise<readonly ChannelFacts[]>;
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
  // Made on first use, so stored maps can be read with no network at all, and
  // shared by crawls, refreshes and keyword searches.
  const connected = onceUntilItWorks(createSource);
  const lazySource = connectOnUse(connected);
  let claudeWorkDir: string | null = null;
  /**
   * Reads the account dates and countries the niche list lacks, from the
   * official API. Without the owner's key there is nothing to ask with, so it
   * does nothing and says nothing. Error text goes to the browser, so it is cleaned.
   */
  const fillFacts = async (listedIds?: readonly string[]): Promise<FactsOutcome | null> => {
    const apiKey = config.youtubeApiKey;
    if (apiKey === undefined) return null;
    const fetchFacts = options.fetchFacts ?? ((ids) => fetchChannelFacts(ids, { apiKey }));
    const outcome = await fillNicheFacts({ ...repos, fetchFacts }, now(), listedIds);
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
      const result = await crawlMap(
        {
          ...repos,
          source: await connected(),
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
      // The refresh has already worked out the niche list; it is not worked out again.
      const facts = await fillFacts(result.nicheIds);
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
      const found = await discoverByKeyword(
        {
          channels: repos.channels,
          videos: repos.videos,
          source: await connected(),
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

    async analyse(analysis, channel) {
      const storePath =
        options.storePath ?? (config.dbPath === IN_MEMORY ? null : resolve(config.dbPath));
      if (storePath === null) {
        throw new Error(
          'Claude needs the store to be a file on disk, and this one is only in memory',
        );
      }
      // Made on first use, owner-only and with a name nobody can guess, so no other
      // account on the computer can plant settings for Claude to pick up there.
      claudeWorkDir ??= mkdtempSync(CLAUDE_WORK_PREFIX);
      const request = analysisRequest(analysis, channel, {
        projectRoot: PROJECT_ROOT,
        dbPath: storePath,
        workDir: claudeWorkDir,
      });
      const run =
        options.runClaude ??
        ((wanted: ClaudeRunRequest) => runClaude(wanted, { spawn: spawnClaude, env: process.env }));
      const { text } = await run(request);
      return { text };
    },

    close() {
      if (claudeWorkDir !== null) rmSync(claudeWorkDir, { recursive: true, force: true });
      db.close();
    },
  };
}
