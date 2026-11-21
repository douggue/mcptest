import { resolve } from 'node:path';
import { readChannelBrand } from './channel/brand';
import { loadConfig } from './config';
import { crawlMap, type CrawlDeps, type CrawlProgress } from './crawl/crawl';
import { backupStore } from './db/backup';
import { openDatabase, transactionRunner, type Db } from './db/sqlite';
import type { VideoPlayerSource } from './downloads/builtInVideo';
import { downloadsRoot } from './downloads/folder';
import { brandLines, thumbnailLines, transcriptLines, videoLines } from './downloads/text';
import { saveChannelThumbnails } from './downloads/thumbnails';
import { downloadVideo } from './downloads/video';
import { formatCount, formatMapTable, formatVideoTable, sanitize } from './format';
import { ingestChannel } from './ingest';
import { withYouTubeLease } from './lease';
import { fillNicheFacts } from './niches/facts';
import { loadMapView } from './map/view';
import { refreshStalest, type RefreshProgress } from './refresh/refresh';
import { buildVideoReport } from './report';
import { SqliteBrandRepo } from './repos/sqliteBrandRepo';
import { SqliteChannelRepo } from './repos/sqliteChannelRepo';
import { SqliteEdgeRepo } from './repos/sqliteEdgeRepo';
import { SqliteFactsRepo } from './repos/sqliteFactsRepo';
import { SqliteLeaseRepo } from './repos/sqliteLeaseRepo';
import { SqliteMapRepo } from './repos/sqliteMapRepo';
import { SqliteRefreshRepo } from './repos/sqliteRefreshRepo';
import { SqliteVideoPageRepo } from './repos/sqliteVideoPageRepo';
import { SqliteVideoRepo } from './repos/sqliteVideoRepo';
import { SqliteWatchlistRepo } from './repos/sqliteWatchlistRepo';
import { fetchChannelFacts } from './sources/dataApi';
import { InnertubeSource } from './sources/innertube';
import { RateLimiter } from './sources/limiter';
import { parseChannelRef } from './sources/parse';
import type { YouTubeSource } from './sources/types';
import { readTranscript } from './video/pages';
import { parseVideoRef } from './video/ref';

const USAGE = [
  'Usage:',
  '  npm run jgtube -- ingest <channel> [--refresh]',
  '  npm run jgtube -- map <channel> [--depth 1|2] [--sample N] [--max-channels N]',
  '  npm run jgtube -- transcript <video>',
  '  npm run jgtube -- thumbnails <channel> [--per-group N]',
  '  npm run jgtube -- brand <channel>',
  '  npm run jgtube -- video <video>',
  '  npm run refresh [-- --max N]',
  '  npm run backup',
  '',
  '<channel> is an @handle, a channel id or a youtube.com URL.',
  '<video> is a video id or a link to one video.',
  'transcript prints a video’s captions and stores them; a stored copy is not read again.',
  'thumbnails saves a stored channel’s winning and ordinary thumbnails and prints the folder.',
  'brand prints a channel’s logo, cover, bio, keywords and links.',
  'video downloads one video as a small temporary file and prints where it is.',
  'refresh reads the stored channels read longest ago again (50 unless --max says otherwise).',
  'backup writes a dated copy of the store beside it and prints where.',
].join('\n');
const FAILURES_SHOWN = 10;
const VIDEO_ROWS_SHOWN = 25;
const MAP_ROWS_SHOWN = 60;
const REQUEST_TIMEOUT_MS = 30_000;

const print = (lines: readonly string[]): void => {
  process.stdout.write(`${lines.join('\n')}\n`);
};

/** Reads `--name 12` from the arguments; undefined when the flag is absent. */
function numberFlag(flags: readonly string[], name: string): number | undefined {
  const index = flags.indexOf(`--${name}`);
  if (index === -1) return undefined;
  const value = Number(flags[index + 1]);
  if (!Number.isInteger(value)) throw new Error(`--${name} needs a whole number`);
  return value;
}

/**
 * The connection to YouTube, made on first use. A command that finds what it
 * needs in the store then makes no request at all.
 */
function lazySource(): YouTubeSource & VideoPlayerSource {
  let made: Promise<InnertubeSource> | null = null;
  const connect = (): Promise<InnertubeSource> => {
    made ??= InnertubeSource.create({
      region: loadConfig().region,
      limiter: new RateLimiter({
        concurrency: 2,
        minDelayMs: 300,
        maxDelayMs: 600,
        maxRetries: 3,
        baseBackoffMs: 2000,
        taskTimeoutMs: REQUEST_TIMEOUT_MS,
      }),
    });
    return made;
  };
  return {
    resolveChannelId: async (handle) => (await connect()).resolveChannelId(handle),
    fetchChannel: async (id, maxVideos) => (await connect()).fetchChannel(id, maxVideos),
    getSidebar: async (videoId) => (await connect()).getSidebar(videoId),
    fetchVideoPage: async (videoId, options) => (await connect()).fetchVideoPage(videoId, options),
    fetchPlayer: async (videoId) => (await connect()).fetchPlayer(videoId),
  };
}

function openEngine(db: Db): CrawlDeps & { readonly brands: SqliteBrandRepo } {
  const config = loadConfig();
  const now = new Date();
  return {
    source: lazySource(),
    brands: new SqliteBrandRepo(db),
    channels: new SqliteChannelRepo(db),
    videos: new SqliteVideoRepo(db),
    edges: new SqliteEdgeRepo(db),
    maps: new SqliteMapRepo(db),
    transact: transactionRunner(db),
    region: config.region,
    now: () => now,
  };
}

async function ingestCommand(deps: CrawlDeps, target: string, refresh: boolean): Promise<void> {
  const result = await ingestChannel(deps, target, { refresh });
  const report = buildVideoReport(result.videos, deps.now());
  const subscribers =
    result.channel.subscribers === null
      ? 'subscribers hidden'
      : `${formatCount(result.channel.subscribers)} subscribers`;
  print([
    `${sanitize(result.channel.title)} · ${subscribers} · ${report.length} videos${result.fromCache ? ' (stored copy)' : ''}`,
    '',
    ...formatVideoTable(report, VIDEO_ROWS_SHOWN),
  ]);
}

function showProgress(progress: CrawlProgress): void {
  const where = progress.step ? ` (step ${progress.step})` : '';
  process.stderr.write(`${progress.stage}${where}: ${progress.channels} channels\n`);
}

async function mapCommand(
  deps: CrawlDeps,
  target: string,
  flags: readonly string[],
): Promise<void> {
  const result = await crawlMap(deps, target, {
    depth: numberFlag(flags, 'depth'),
    sampleSize: numberFlag(flags, 'sample'),
    maxChannels: numberFlag(flags, 'max-channels'),
    onProgress: showProgress,
  });
  const view = loadMapView(deps, result.members, result.depth, deps.now(), result.modelChannelId);
  if (!view) throw new Error('The map was saved but its centre channel could not be loaded');
  print([
    `Map of ${sanitize(view.center.channel.title)}: ${view.rows.length} channels`,
    '',
    ...formatMapTable(view.rows, MAP_ROWS_SHOWN),
    ...(result.warnings.length > 0
      ? [
          '',
          `${result.warnings.length} warnings:`,
          ...result.warnings.map((w) => `  ${sanitize(w)}`),
        ]
      : []),
  ]);
}

function showRefreshProgress(progress: RefreshProgress): void {
  process.stderr.write(`refreshing: ${progress.done} of ${progress.total} channels\n`);
}

/**
 * Reads the account dates the niche list lacks from the official API. Without
 * the owner's key there is nothing to ask with, so it says nothing.
 */
async function factsLines(
  deps: CrawlDeps,
  db: Db,
  listedIds: readonly string[],
): Promise<readonly string[]> {
  const apiKey = loadConfig().youtubeApiKey;
  if (apiKey === undefined) return [];
  const outcome = await fillNicheFacts(
    {
      ...deps,
      watchlist: new SqliteWatchlistRepo(db),
      facts: new SqliteFactsRepo(db),
      fetchFacts: (ids) => fetchChannelFacts(ids, { apiKey }),
    },
    new Date(),
    listedIds,
  );
  return outcome.problem
    ? [`Account dates could not be read: ${sanitize(outcome.problem)}`]
    : [`Account dates read for ${outcome.added} of ${outcome.asked} channels that lacked them.`];
}

/** Reads the stalest stored channels again. Each read is stamped with the time it happened. */
async function refreshCommand(deps: CrawlDeps, db: Db, flags: readonly string[]): Promise<void> {
  const maxChannels = numberFlag(flags, 'max');
  const result = await refreshStalest(
    {
      ...deps,
      watchlist: new SqliteWatchlistRepo(db),
      runs: new SqliteRefreshRepo(db),
      now: () => new Date(),
    },
    { onProgress: showRefreshProgress, ...(maxChannels === undefined ? {} : { maxChannels }) },
  );
  const facts = await factsLines(deps, db, result.nicheIds);
  print([
    `Read ${result.refreshed.length} of ${result.picked} channels again; ${result.failed.length} could not be read.`,
    ...(result.stoppedEarly
      ? [`Stopped early: YouTube refused several in a row. ${result.notAttempted} were not tried.`]
      : []),
    `${result.stillDue} channels are still due; a later run takes them.`,
    ...facts,
    ...result.failed
      .slice(0, FAILURES_SHOWN)
      .map((failure) => `  ${failure.channelId}: ${sanitize(failure.error)}`),
  ]);
}

/** Prints a video's captions, reading and storing them when they are not stored yet. */
async function transcriptCommand(db: Db, target: string): Promise<void> {
  const pages = new SqliteVideoPageRepo(db);
  const result = await readTranscript(
    { source: lazySource(), transcripts: pages, details: pages, now: () => new Date() },
    parseVideoRef(target),
  );
  print(transcriptLines(result));
}

/** Saves a stored channel's winning and ordinary thumbnails and prints the folder. */
async function thumbnailsCommand(db: Db, target: string, flags: readonly string[]): Promise<void> {
  const channels = new SqliteChannelRepo(db);
  const ref = parseChannelRef(target);
  const stored = ref.kind === 'id' ? channels.findById(ref.id) : channels.findByHandle(ref.handle);
  if (!stored) {
    throw new Error(
      'That channel is not in the store yet. Read it first: npm run jgtube -- ingest <channel>',
    );
  }
  const perGroup = numberFlag(flags, 'per-group');
  const result = await saveChannelThumbnails(
    { channels, videos: new SqliteVideoRepo(db), now: () => new Date() },
    stored.id,
    downloadsRoot(loadConfig()),
    perGroup === undefined ? {} : { perGroup },
  );
  if (result) print(thumbnailLines(result));
}

/** Downloads one video as a small temporary file and prints where it is. */
async function videoCommand(target: string): Promise<void> {
  const result = await downloadVideo(target, {
    root: downloadsRoot(loadConfig()),
    source: lazySource(),
  });
  print(videoLines(result));
  if (!result.ok) process.exitCode = 1;
}

const SMALL_READS = ['transcript', 'thumbnails', 'brand', 'video'] as const;
type SmallRead = (typeof SMALL_READS)[number];

interface Targeted<Command extends string> {
  readonly command: Command;
  readonly target: string;
  readonly flags: readonly string[];
}

type SmallRequest = Targeted<SmallRead>;
/** A map, an ingest or a refresh: work that reads YouTube at length. */
type LongRequest =
  { readonly command: 'refresh'; readonly flags: readonly string[] } | Targeted<'ingest' | 'map'>;
type Request = { readonly command: 'backup' } | LongRequest | SmallRequest;

const isSmallRead = (command: string): command is SmallRead =>
  (SMALL_READS as readonly string[]).includes(command);

const isSmallRequest = (request: Request): request is SmallRequest => isSmallRead(request.command);

/** What the arguments ask for, or null when they do not make a command. */
function parseArguments(argv: readonly string[]): Request | null {
  const [command, target, ...flags] = argv;
  if (command === 'backup') return { command };
  if (command === 'refresh') return { command, flags: argv.slice(1) };
  if (command === undefined || !target) return null;
  if (isSmallRead(command)) return { command, target, flags };
  return command === 'ingest' || command === 'map' ? { command, target, flags } : null;
}

/**
 * The commands that read one video or one channel. They make a request or
 * two through the rate limiter, or none when the store has the answer, so
 * they do not wait for the lease that a crawl or a refresh holds.
 */
async function readOne(db: Db, request: SmallRequest): Promise<void> {
  const { command, target, flags } = request;
  if (command === 'transcript') return transcriptCommand(db, target);
  if (command === 'thumbnails') return thumbnailsCommand(db, target, flags);
  if (command === 'video') return videoCommand(target);
  print(brandLines(await readChannelBrand(openEngine(db), target)));
}

/** Reads settings from a `.env` file where the command is run, as the app does, if there is one. */
function loadEnvFile(): void {
  try {
    process.loadEnvFile();
  } catch {
    // No .env file: settings come from the environment or their defaults.
  }
}

async function readYouTube(db: Db, request: LongRequest) {
  const deps = openEngine(db);
  if (request.command === 'refresh') {
    await refreshCommand(deps, db, request.flags);
  } else if (request.command === 'ingest') {
    await ingestCommand(deps, request.target, request.flags.includes('--refresh'));
  } else {
    await mapCommand(deps, request.target, request.flags);
  }
}

async function main(argv: readonly string[]): Promise<void> {
  loadEnvFile();
  const request = parseArguments(argv);
  if (!request) {
    process.stderr.write(`${USAGE}\n`);
    process.exitCode = 1;
    return;
  }
  const { dbPath } = loadConfig();
  const db = openDatabase(dbPath);
  try {
    if (request.command === 'backup') {
      // Needs no connection to YouTube, so it is done before one is made.
      print([`Backup written to ${resolve(backupStore(db, dbPath, new Date()))}`]);
      return;
    }
    if (isSmallRequest(request)) {
      await readOne(db, request);
      return;
    }
    // A map, an ingest and a refresh read YouTube at length, so each waits its
    // turn behind the web app and the connector, and is refused before it
    // connects to anything.
    await withYouTubeLease({ leases: new SqliteLeaseRepo(db), now: () => new Date() }, () =>
      readYouTube(db, request),
    );
  } finally {
    db.close();
  }
}

main(process.argv.slice(2)).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Error: ${sanitize(message)}\n`);
  process.exitCode = 1;
});
