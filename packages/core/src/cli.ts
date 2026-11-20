import { loadConfig } from './config';
import { crawlMap, type CrawlDeps, type CrawlProgress } from './crawl/crawl';
import { openDatabase, transactionRunner, type Db } from './db/sqlite';
import { formatCount, formatMapTable, formatVideoTable, sanitize } from './format';
import { ingestChannel } from './ingest';
import { loadMapView } from './map/view';
import { buildVideoReport } from './report';
import { SqliteChannelRepo } from './repos/sqliteChannelRepo';
import { SqliteEdgeRepo } from './repos/sqliteEdgeRepo';
import { SqliteMapRepo } from './repos/sqliteMapRepo';
import { SqliteVideoRepo } from './repos/sqliteVideoRepo';
import { InnertubeSource } from './sources/innertube';
import { RateLimiter } from './sources/limiter';

const USAGE = [
  'Usage:',
  '  npm run scout -- ingest <channel> [--refresh]',
  '  npm run scout -- map <channel> [--depth 1|2] [--sample N] [--max-channels N]',
  '',
  '<channel> is an @handle, a channel id or a youtube.com URL.',
].join('\n');
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

async function openEngine(db: Db): Promise<CrawlDeps> {
  const config = loadConfig();
  const limiter = new RateLimiter({
    concurrency: 2,
    minDelayMs: 300,
    maxDelayMs: 600,
    maxRetries: 3,
    baseBackoffMs: 2000,
    taskTimeoutMs: REQUEST_TIMEOUT_MS,
  });
  const now = new Date();
  return {
    source: await InnertubeSource.create({ limiter, region: config.region }),
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
  const view = loadMapView(deps, result.members, result.depth, deps.now());
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

async function main(argv: readonly string[]): Promise<void> {
  const [command, target, ...flags] = argv;
  if ((command !== 'ingest' && command !== 'map') || !target) {
    process.stderr.write(`${USAGE}\n`);
    process.exitCode = 1;
    return;
  }
  const db = openDatabase(loadConfig().dbPath);
  try {
    const deps = await openEngine(db);
    if (command === 'ingest') {
      await ingestCommand(deps, target, flags.includes('--refresh'));
    } else {
      await mapCommand(deps, target, flags);
    }
  } finally {
    db.close();
  }
}

main(process.argv.slice(2)).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Error: ${sanitize(message)}\n`);
  process.exitCode = 1;
});
