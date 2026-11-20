import { loadConfig } from './config';
import { openDatabase, transactionRunner } from './db/sqlite';
import { ingestChannel } from './ingest';
import { buildVideoReport, type VideoReportRow } from './report';
import { SqliteChannelRepo } from './repos/sqliteChannelRepo';
import { SqliteVideoRepo } from './repos/sqliteVideoRepo';
import { InnertubeSource } from './sources/innertube';
import { RateLimiter } from './sources/limiter';

const USAGE = 'Usage: npm run scout -- ingest <@handle | channel id | youtube.com URL> [--refresh]';
const ROWS_SHOWN = 25;
const TITLE_WIDTH = 72;
const REQUEST_TIMEOUT_MS = 30_000;
/** Titles are untrusted; control characters could otherwise drive the terminal. */
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/g;

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

function formatScore(score: number | null): string {
  if (score === null) return 'new';
  return `${score >= 100 ? Math.round(score) : score.toFixed(1)}x`;
}

function formatRow(row: VideoReportRow): string {
  const title = row.title.replace(CONTROL_CHARACTERS, ' ').slice(0, TITLE_WIDTH);
  return [
    formatScore(row.score).padStart(8),
    compact.format(row.views).padStart(7),
    `${Math.round(row.ageDays)}d`.padStart(6),
    title,
  ].join('  ');
}

async function ingestCommand(target: string, refresh: boolean): Promise<void> {
  const config = loadConfig();
  const db = openDatabase(config.dbPath);
  try {
    const limiter = new RateLimiter({
      concurrency: 2,
      minDelayMs: 300,
      maxDelayMs: 600,
      maxRetries: 3,
      baseBackoffMs: 2000,
      taskTimeoutMs: REQUEST_TIMEOUT_MS,
    });
    const source = await InnertubeSource.create({
      limiter,
      region: config.region,
    });
    const now = new Date();
    const result = await ingestChannel(
      {
        source,
        channels: new SqliteChannelRepo(db),
        videos: new SqliteVideoRepo(db),
        transact: transactionRunner(db),
        now: () => now,
      },
      target,
      { refresh },
    );
    const report = buildVideoReport(result.videos, now);
    const subscribers =
      result.channel.subscribers === null
        ? 'subscribers hidden'
        : `${compact.format(result.channel.subscribers)} subscribers`;
    const lines = [
      `${result.channel.title.replace(CONTROL_CHARACTERS, ' ')} · ${subscribers} · ${report.length} videos${result.fromCache ? ' (stored copy)' : ''}`,
      '',
      ['score'.padStart(8), 'views'.padStart(7), 'age'.padStart(6), 'title'].join('  '),
      ...report.slice(0, ROWS_SHOWN).map(formatRow),
    ];
    process.stdout.write(`${lines.join('\n')}\n`);
  } finally {
    db.close();
  }
}

async function main(argv: readonly string[]): Promise<void> {
  const [command, target, ...flags] = argv;
  if (command !== 'ingest' || !target) {
    process.stderr.write(`${USAGE}\n`);
    process.exitCode = 1;
    return;
  }
  await ingestCommand(target, flags.includes('--refresh'));
}

main(process.argv.slice(2)).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Error: ${message.replace(CONTROL_CHARACTERS, ' ')}\n`);
  process.exitCode = 1;
});
