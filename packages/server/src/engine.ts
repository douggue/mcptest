import {
  SqliteChannelRepo,
  SqliteEdgeRepo,
  SqliteFactsRepo,
  SqliteLeaseRepo,
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
  withYouTubeLease,
  type ChannelFacts,
  type Config,
  type Db,
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

function openRepos(db: Db) {
  return {
    channels: new SqliteChannelRepo(db),
    videos: new SqliteVideoRepo(db),
    edges: new SqliteEdgeRepo(db),
    maps: new SqliteMapRepo(db),
    watchlist: new SqliteWatchlistRepo(db),
    runs: new SqliteRefreshRepo(db),
    facts: new SqliteFactsRepo(db),
  };
}

/** What every part of the engine is built from. */
interface Wiring {
  readonly config: Config;
  readonly options: EngineOptions;
  readonly db: Db;
  readonly now: () => Date;
  readonly repos: ReturnType<typeof openRepos>;
  readonly leases: SqliteLeaseRepo;
  /** The connection to YouTube, made on first use and shared by all work. */
  readonly connected: () => Promise<YouTubeSource>;
  /** A source that connects on first use, so work that reads nothing makes no request. */
  readonly lazySource: YouTubeSource;
  /**
   * Runs work that reads YouTube while holding the store's lease, so it never
   * runs beside the same kind of work in another program (the connector, the
   * command line, a second server). Refused work rejects before it connects.
   */
  readonly reading: <T>(work: () => Promise<T>) => Promise<T>;
}

function wire(config: Config, options: EngineOptions): Wiring {
  const db = openDatabase(config.dbPath);
  const now = options.now ?? (() => new Date());
  const leases = new SqliteLeaseRepo(db);
  // Made on first use, so stored maps can be read with no network at all, and
  // shared by crawls, refreshes and keyword searches.
  const connected = onceUntilItWorks(options.createSource ?? (() => youtubeSource(config)));
  return {
    config,
    options,
    db,
    now,
    repos: openRepos(db),
    leases,
    connected,
    lazySource: connectOnUse(connected),
    reading: (work) => withYouTubeLease({ leases, now }, work),
  };
}

type MapReads = Pick<Engine, 'findSnapshot' | 'findThumbnailBoard' | 'findSameTopic'>;

/** Reads of a channel's latest map; the store only. */
function mapReads({ repos, now }: Wiring): MapReads {
  /** The stored channel a handle, link or id refers to. */
  const findStored = (channel: string): StoredChannel | null => {
    const ref = parseChannelRef(channel);
    return ref.kind === 'id'
      ? repos.channels.findById(ref.id)
      : repos.channels.findByHandle(ref.handle);
  };
  const latest =
    <T>(load: (channelId: string) => T | null) =>
    (channel: string): T | null => {
      const stored = findStored(channel);
      return stored ? load(stored.id) : null;
    };
  return {
    findSnapshot: latest((id) => loadMapSnapshot(repos, id, now())),
    findThumbnailBoard: latest((id) => loadThumbnailBoard(repos, id, now())),
    findSameTopic: latest((id) => loadSameTopicList(repos, id, now())),
  };
}

type OwnerChoices = Pick<Engine, 'setCompetitorStatus' | 'listNiches' | 'setNicheWatched'>;

/** The niche list and the owner's say on competitors and niches; the store only. */
function ownerChoices({ repos, now }: Wiring): OwnerChoices {
  return {
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
  };
}

/** Making a map: reads YouTube. */
function crawling({ config, db, now, repos, connected, reading }: Wiring): Pick<Engine, 'crawl'> {
  return {
    crawl(channel, depth, onProgress, choices = {}) {
      const { model, maxChannels } = choices;
      return reading(async () => {
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
      });
    },
  };
}

type FillFacts = (listedIds?: readonly string[]) => Promise<FactsOutcome | null>;

/**
 * Reads the account dates and countries the niche list lacks, from the
 * official API. Without the owner's key there is nothing to ask with, so it
 * does nothing and says nothing. Error text goes to the browser, so it is cleaned.
 */
function factsFiller({ config, options, repos, now }: Wiring): FillFacts {
  return async (listedIds) => {
    const apiKey = config.youtubeApiKey;
    if (apiKey === undefined) return null;
    const fetchFacts = options.fetchFacts ?? ((ids) => fetchChannelFacts(ids, { apiKey }));
    const outcome = await fillNicheFacts({ ...repos, fetchFacts }, now(), listedIds);
    return { ...outcome, problem: outcome.problem === null ? null : cleanMessage(outcome.problem) };
  };
}

type Refreshing = Pick<Engine, 'refresh' | 'refreshStatus'>;

/** Reading stored channels again, and when that was last done. */
function refreshing(wiring: Wiring, fillFacts: FillFacts): Refreshing {
  const { config, db, now, repos, lazySource, reading } = wiring;
  return {
    refresh(onProgress, maxChannels) {
      return reading(async () => {
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
      });
    },

    refreshStatus() {
      return { ...loadRefreshStatus(repos, now()), everyHours: config.refreshHours ?? null };
    },
  };
}

type Discovery = Pick<Engine, 'canDiscover' | 'discover'>;

/** Keyword search: the official API finds videos, then their channels are read from YouTube. */
function discovery(wiring: Wiring, fillFacts: FillFacts): Discovery {
  const { config, options, db, now, repos, connected, reading } = wiring;
  return {
    canDiscover() {
      return config.youtubeApiKey !== undefined;
    },

    async discover(keyword) {
      const apiKey = config.youtubeApiKey;
      if (apiKey === undefined) throw new Error('Keyword search needs a YouTube API key');
      const search =
        options.search ??
        ((query: string, { publishedAfter }: { readonly publishedAfter: Date }) =>
          searchRecentVideos(query, { apiKey, publishedAfter }));
      return reading(async () => {
        const found = await discoverByKeyword(
          {
            channels: repos.channels,
            videos: repos.videos,
            source: await connected(),
            transact: transactionRunner(db),
            now,
            search,
          },
          keyword,
        );
        return { ...found, facts: await fillFacts() };
      });
    },
  };
}

interface ClaudeAnalyses extends Pick<Engine, 'analyse'> {
  /** Removes the private folder Claude was started in, if one was made. */
  cleanUp(): void;
}

/** The fixed analyses, each one boxed-in run of Claude Code. */
function claudeAnalyses({ config, options }: Wiring): ClaudeAnalyses {
  let workDir: string | null = null;
  const run =
    options.runClaude ??
    ((wanted: ClaudeRunRequest) => runClaude(wanted, { spawn: spawnClaude, env: process.env }));
  return {
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
      workDir ??= mkdtempSync(CLAUDE_WORK_PREFIX);
      const request = analysisRequest(analysis, channel, {
        projectRoot: PROJECT_ROOT,
        dbPath: storePath,
        workDir,
      });
      const { text } = await run(request);
      return { text };
    },

    cleanUp() {
      if (workDir !== null) rmSync(workDir, { recursive: true, force: true });
    },
  };
}

/** Wires the API to the store and to YouTube. */
export function createEngine(config: Config, options: EngineOptions = {}): RunningEngine {
  const wiring = wire(config, options);
  const fillFacts = factsFiller(wiring);
  const claude = claudeAnalyses(wiring);
  return {
    ...mapReads(wiring),
    ...ownerChoices(wiring),
    ...crawling(wiring),
    ...refreshing(wiring, fillFacts),
    ...discovery(wiring, fillFacts),
    analyse: claude.analyse,

    isReadingYouTube() {
      return wiring.leases.holder(wiring.now()) !== null;
    },

    close() {
      claude.cleanUp();
      wiring.db.close();
    },
  };
}
