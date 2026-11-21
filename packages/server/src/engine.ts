import {
  SqliteChannelRepo,
  SqliteConceptRepo,
  SqliteEdgeRepo,
  SqliteFactsRepo,
  SqliteFormulaRepo,
  SqliteHookLabelRepo,
  SqliteLeaseRepo,
  SqliteMapRepo,
  SqliteOwnerPlaceRepo,
  SqliteRefreshRepo,
  SqliteScriptRepo,
  SqliteBrandRepo,
  SqliteBreakdownRepo,
  SqliteChannelNoteRepo,
  SqliteConceptThumbnailRepo,
  SqliteTransferRepo,
  SqliteVideoPageRepo,
  SqliteVideoRepo,
  SqliteVideoStudyRepo,
  SqliteWatchlistRepo,
  crawlMap,
  discoverByKeyword,
  downloadVideo,
  downloadsRoot,
  fetchChannelFacts,
  fillNicheFacts,
  listSavedChannels,
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
  type ApiVideoDetails,
  type ChannelFacts,
  type Config,
  type Db,
  type FactsOutcome,
  type FetchImage,
  type SearchHit,
  type StoredChannel,
  type VideoPlayerSource,
  type YouTubeSource,
} from '@jgtube/core';
import { randomUUID } from 'node:crypto';
import { analysisEngines, type AnalysisOptions } from './analysisEngine';
import { answerEngine } from './answerEngine';
import type { Engine } from './app';
import { breakdownFiles } from './breakdownFiles';
import { breaking } from './breakdownSetup';
import {
  connectOnUse,
  onceUntilItWorks,
  stopWhen,
  youtubeSource,
  type PlayerSource,
} from './connection';
import { downloads } from './downloadEngine';
import { cleanMessage } from './jobs';
import { lab } from './labSetup';
import { logos } from './logoEngine';
import { trackWork, type WorkTracker } from './running';
import { transfers } from './transferEngine';
import { videoCopies, type FetchVideoFile } from './videoCopies';

/**
 * How long shutting down waits for work under way. Work that reads YouTube
 * finishes the request it is on (thirty seconds at the very most) and is
 * refused the next, so it ends well inside this.
 */
const CLOSE_GRACE_MS = 10_000;

export interface RunningEngine extends Engine {
  /**
   * Closes the store at once, giving back any lease still held. Work under way
   * fails at its next use of the store; use `shutdown` when there may be some.
   */
  close(): void;
  /**
   * Stops any AI engine that is running, starts no new work, lets work under
   * way wind down, and then closes the store. Safe to call more than once.
   */
  shutdown(): Promise<void>;
}

export interface EngineOptions extends AnalysisOptions {
  /** Replaces the connection to YouTube; used by tests. */
  readonly createSource?: () => Promise<PlayerSource>;
  /** Replaces fetching a video file (core's `downloadVideo`); used by tests. */
  readonly fetchVideoFile?: FetchVideoFile;
  /** Where the helper programs (yt-dlp, ffmpeg) are looked for; tests replace it. */
  readonly programEnv?: Readonly<Record<string, string | undefined>>;
  readonly now?: () => Date;
  /** Replaces the official API's search; used by tests. */
  readonly search?: (
    query: string,
    options: { readonly publishedAfter: Date },
  ) => Promise<readonly SearchHit[]>;
  /** How long shutting down waits for work under way; tests shorten it. */
  readonly closeGraceMs?: number;
  /** Replaces the official API's channel facts; used by tests. It is only called when a key is set. */
  readonly fetchFacts?: (channelIds: readonly string[]) => Promise<readonly ChannelFacts[]>;
  /** Replaces the official API's video details; used by tests. It is only called when a key is set. */
  readonly fetchVideoDetails?: (videoIds: readonly string[]) => Promise<readonly ApiVideoDetails[]>;
  /** Replaces the network for thumbnails, frame sheets and channel pictures; used by tests. */
  readonly fetchImage?: FetchImage;
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
    transfers: new SqliteTransferRepo(db),
    ownerPlaces: new SqliteOwnerPlaceRepo(db),
    // With this among them, every read of a channel also stores its logo, cover and bio.
    brands: new SqliteBrandRepo(db),
    pages: new SqliteVideoPageRepo(db),
    studies: new SqliteVideoStudyRepo(db),
    concepts: new SqliteConceptRepo(db),
    formulas: new SqliteFormulaRepo(db),
    hookLabels: new SqliteHookLabelRepo(db),
    scripts: new SqliteScriptRepo(db),
    breakdowns: new SqliteBreakdownRepo(db),
    notes: new SqliteChannelNoteRepo(db),
    conceptThumbnails: new SqliteConceptThumbnailRepo(db),
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
  /**
   * A source that connects on first use, so work that reads nothing makes no
   * request. It can also ask for a video's files, for the built-in download.
   */
  readonly lazySource: YouTubeSource & VideoPlayerSource;
  /**
   * Runs work that reads YouTube while holding the store's lease, so it never
   * runs beside the same kind of work in another program (the connector, the
   * command line, a second server). Refused work rejects before it connects.
   */
  readonly reading: <T>(work: () => Promise<T>) => Promise<T>;
  /** The work under way, so shutting down can wait for it. */
  readonly work: WorkTracker;
  /** Gives back every lease this engine still holds. */
  readonly releaseLeases: () => void;
}

function wire(config: Config, options: EngineOptions): Wiring {
  const db = openDatabase(config.dbPath);
  const now = options.now ?? (() => new Date());
  const leases = new SqliteLeaseRepo(db);
  const work = trackWork();
  // Made on first use, so stored maps can be read with no network at all, and
  // shared by crawls, refreshes and keyword searches. Once the engine is
  // shutting down it asks YouTube for nothing more.
  const connect = onceUntilItWorks(options.createSource ?? (() => youtubeSource(config)));
  const connected = async (): Promise<PlayerSource> => stopWhen(await connect(), work.isClosing);
  // The leases this engine holds now, by owner, so closing can give them back.
  let held: ReadonlySet<string> = new Set();
  const holding = <T>(reads: () => Promise<T>): Promise<T> => {
    const owner = randomUUID();
    held = new Set([...held, owner]);
    return withYouTubeLease({ leases, now, newOwner: () => owner }, reads).finally(() => {
      held = new Set([...held].filter((other) => other !== owner));
    });
  };
  return {
    config,
    options,
    db,
    now,
    repos: openRepos(db),
    leases,
    connected,
    lazySource: connectOnUse(connected),
    reading: (reads) => work.run(() => holding(reads)),
    work,
    releaseLeases: () => held.forEach((owner) => leases.release(owner)),
  };
}

type MapReads = Pick<
  Engine,
  | 'findSnapshot'
  | 'findThumbnailBoard'
  | 'findSameTopic'
  | 'listSavedChannels'
  | 'deleteSavedChannel'
>;

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
    listSavedChannels: () => listSavedChannels(repos),
    deleteSavedChannel: (channelId) => repos.maps.deleteForCenter(channelId) > 0,
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
type FetchFacts = (channelIds: readonly string[]) => Promise<readonly ChannelFacts[]>;

/**
 * The call that reads channel facts from the official API with the owner's
 * key, or null when no key is set. The key is read when this is called, so
 * one saved from the settings screen is used by the next request.
 */
function factsFetcher({ config, options }: Wiring): FetchFacts | null {
  const apiKey = config.youtubeApiKey;
  if (apiKey === undefined) return null;
  return options.fetchFacts ?? ((ids) => fetchChannelFacts(ids, { apiKey }));
}

/**
 * Reads the account dates and countries the niche list lacks, from the
 * official API. Without the owner's key there is nothing to ask with, so it
 * does nothing and says nothing. Error text goes to the browser, so it is cleaned.
 */
function factsFiller(wiring: Wiring): FillFacts {
  const { repos, now } = wiring;
  return async (listedIds) => {
    const fetchFacts = factsFetcher(wiring);
    if (fetchFacts === null) return null;
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
            brands: repos.brands,
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

/** Wires the API to the store and to YouTube. */
export function createEngine(config: Config, options: EngineOptions = {}): RunningEngine {
  const wiring = wire(config, options);
  const fillFacts = factsFiller(wiring);
  const stopEngines = new AbortController();
  const stop = stopEngines.signal;
  const root = (): string => downloadsRoot(config);
  // Temporary copies of videos: each comes with the way to remove it, and any
  // still on disk when the engine closes is removed then.
  const env = options.programEnv ? { env: options.programEnv } : {};
  const copies = videoCopies({
    root,
    fetch:
      options.fetchVideoFile ??
      ((videoId, signal) =>
        downloadVideo(videoId, { root: root(), source: wiring.lazySource, signal, ...env })),
  });
  const asking = analysisEngines(
    { ...wiring, options: { ...options, downloadVideo: options.downloadVideo ?? copies.fetch } },
    stop,
  );
  const reading = downloads({
    ...wiring,
    transact: transactionRunner(wiring.db),
    run: wiring.work.run,
    fetchImage: options.fetchImage,
    fetchVideoDetails: options.fetchVideoDetails,
  });
  const files = breakdownFiles({ root, fetch: copies.fetch, stop, ...env });
  const maps = mapReads(wiring);
  const transferring = transfers({ ...wiring, factsFetcher: () => factsFetcher(wiring) });
  let closed = false;
  let shuttingDown: Promise<void> | null = null;
  const close = (): void => {
    if (closed) return;
    closed = true;
    // Work cut short cannot give its lease back once the store is closed.
    wiring.releaseLeases();
    asking.cleanUp();
    copies.removeLeftovers();
    wiring.db.close();
  };
  return {
    ...maps,
    ...ownerChoices(wiring),
    ...transferring,
    ...logos({ ...wiring, findSnapshot: maps.findSnapshot }),
    ...answerEngine(wiring),
    ...reading,
    ...crawling(wiring),
    ...refreshing(wiring, fillFacts),
    ...discovery(wiring, fillFacts),
    ...breaking({
      config,
      now: wiring.now,
      videos: wiring.repos.videos,
      studies: wiring.repos.studies,
      channels: wiring.repos.channels,
      breakdowns: wiring.repos.breakdowns,
      run: wiring.work.run,
      asking,
      reading,
      files,
      stop,
    }),
    ...lab({
      now: wiring.now,
      repos: wiring.repos,
      analyse: asking.analyse,
      listTransfers: transferring.listTransfers,
      findSnapshot: maps.findSnapshot,
      readTranscript: reading.readTranscript,
      isClosing: wiring.work.isClosing,
      // Read at each use: the owner can change it from the settings screen while Jgtube runs.
      markFacts: () => config.markFacts !== false,
    }),
    analyse: asking.analyse,
    watchVideo: asking.watchVideo,
    engineStatus: asking.engineStatus,

    isReadingYouTube() {
      return wiring.leases.holder(wiring.now()) !== null;
    },

    close,

    shutdown() {
      shuttingDown ??= (async () => {
        stopEngines.abort();
        await wiring.work.windDown(options.closeGraceMs ?? CLOSE_GRACE_MS);
        close();
      })();
      return shuttingDown;
    },
  };
}
