/**
 * Reads the outlier bank from the store: the `outlier_bank_rows` view, one
 * row per stored video (a video id is the table's key, so each is there once),
 * grouped by channel and scored the way every other view scores. The result
 * is kept until the store changes.
 */
import { LOGO_SHOWN_MIN_WIDTH, pickImage } from '../channel/brand';
import type { Db } from '../db/sqlite';
import { cautionFor } from '../map/breakouts';
import { moneyVerdict } from '../money/verdict';
import type { AdsSeen } from '../money/watchSigns';
import { NICHE_MIN_LATIN_SHARE, dominantScript, latinShare } from '../niches/script';
import { assignTopics, type NicheTopic } from '../niches/topic';
import { buildVideoReport } from '../report';
import { pinnedImages, storedWords } from '../repos/sqliteBrandRepo';
import type { StoredVideo } from '../repos/types';
import { SHORTS_MAX_SECONDS } from '../scoring/earnings';
import type { DatePrecision } from '../sources/types';
import type { Bank, BankChannel, BankCloseness, BankVideo } from './types';

/** Newest titles per channel the alphabet is told from, as on New niches. */
const TITLES_CHECKED = 30;

export interface BankRow {
  readonly video_id: string;
  readonly channel_id: string;
  readonly title: string;
  readonly views: number;
  readonly duration_s: number | null;
  readonly published_at: string;
  readonly published_precision: DatePrecision;
  readonly published_raw: string;
  readonly read_at: string;
  readonly channel_title: string;
  readonly handle: string | null;
  readonly subscribers: number | null;
  readonly subs_hidden: number;
  readonly country: string | null;
  readonly avatar_json: string | null;
  readonly keywords_json: string | null;
  readonly description: string | null;
  readonly memberships: number | null;
  readonly ads: AdsSeen | null;
  readonly money_checked_at: string | null;
  readonly money_video_id: string | null;
  readonly on_a_map: number;
}

export interface BankContext {
  /** How close a channel is to one of the owner's channels; null when on no map's look-alikes. */
  readonly closenessOf: (channelId: string) => BankCloseness | null;
}

/** Every row of the bank's view, a channel's videos together, newest first. */
export function loadBankRows(db: Db): readonly BankRow[] {
  return db
    .prepare<[], BankRow>(
      'SELECT * FROM outlier_bank_rows ORDER BY channel_id, published_at DESC, video_id',
    )
    .all();
}

/** What changes whenever anything the bank shows could have changed. */
export function bankFingerprint(db: Db): string {
  const row = db
    .prepare<[], Record<string, unknown>>(
      `SELECT (SELECT count(*) FROM videos) AS v, (SELECT max(fetched_at) FROM videos) AS vf,
              (SELECT max(fetched_at) FROM channels) AS cf,
              (SELECT max(brand_fetched_at) FROM channels) AS bf,
              (SELECT max(facts_fetched_at) FROM channels) AS ff,
              (SELECT count(*) || max(checked_at) FROM channel_money_signs) AS m,
              (SELECT count(*) || max(id) FROM maps) AS mp,
              (SELECT count(*) FROM map_removals) || (SELECT count(*) FROM map_keeps) AS ch`,
    )
    .get();
  return JSON.stringify(row ?? {});
}

function toStoredVideo(row: BankRow): StoredVideo {
  return {
    id: row.video_id,
    channelId: row.channel_id,
    title: row.title,
    views: row.views,
    durationSeconds: row.duration_s,
    published: {
      date: new Date(row.published_at),
      precision: row.published_precision,
      raw: row.published_raw,
    },
    fetchedAt: new Date(row.read_at),
  };
}

function groupByChannel(rows: readonly BankRow[]): ReadonlyMap<string, readonly BankRow[]> {
  const groups = new Map<string, BankRow[]>();
  for (const row of rows) {
    const group = groups.get(row.channel_id);
    if (group) group.push(row);
    else groups.set(row.channel_id, [row]);
  }
  return groups;
}

function alphabetOf(titles: readonly string[]): string {
  const newest = titles.slice(0, TITLES_CHECKED);
  if (newest.length === 0 || latinShare(newest) >= NICHE_MIN_LATIN_SHARE) return 'latin';
  return dominantScript(newest) ?? 'other';
}

function moneyOf(first: BankRow) {
  const signs =
    first.memberships === null || first.ads === null || first.money_checked_at === null
      ? null
      : {
          channelId: first.channel_id,
          videoId: first.money_video_id ?? '',
          memberships: first.memberships === 1,
          ads: first.ads,
          checkedAt: new Date(first.money_checked_at),
        };
  const channel = {
    id: first.channel_id,
    subscribers: first.subscribers,
    subscribersHidden: first.subs_hidden === 1,
  };
  return moneyVerdict(channel, signs).status;
}

function channelOf(
  rows: readonly BankRow[],
  topic: NicheTopic,
  context: BankContext,
): BankChannel | null {
  const first = rows[0];
  if (!first) return null;
  return {
    id: first.channel_id,
    title: first.channel_title,
    handle: first.handle,
    subscribers: first.subscribers,
    logoUrl: pickImage(pinnedImages(first.avatar_json), LOGO_SHOWN_MIN_WIDTH)?.url ?? null,
    country: first.country,
    topic,
    alphabet: alphabetOf(rows.map((row) => row.title)),
    money: moneyOf(first),
    closeness: context.closenessOf(first.channel_id),
    onAMap: first.on_a_map === 1,
  };
}

function videosOf(rows: readonly BankRow[], channel: BankChannel, now: Date): BankVideo[] {
  const byId = new Map(rows.map((row) => [row.video_id, row]));
  return buildVideoReport(rows.map(toStoredVideo), now).flatMap((report): BankVideo[] => {
    const row = byId.get(report.id);
    if (!row) return [];
    const scored = report.score !== null && report.baseline !== null && report.sampleSize !== null;
    return [
      {
        videoId: report.id,
        title: report.title,
        views: report.views,
        ageDays: report.ageDays,
        publishedAt: row.published_at,
        publishedRaw: row.published_raw,
        durationSeconds: row.duration_s,
        isShort: row.duration_s !== null && row.duration_s <= SHORTS_MAX_SECONDS,
        score: report.score,
        baseline: report.baseline,
        sampleSize: report.sampleSize,
        caution: scored ? cautionFor(report.sampleSize ?? 0, report.baseline ?? 0) : null,
        viewsPerDay: report.views / Math.max(1, report.ageDays),
        readAt: row.read_at,
        channel,
      },
    ];
  });
}

const OTHER: NicheTopic = { label: 'Other', source: 'none' };

/** Each channel's subject, from its own keywords, else its name and titles. */
function topicsOf(groups: ReadonlyMap<string, readonly BankRow[]>) {
  return assignTopics(
    [...groups.entries()].map(([id, rows]) => {
      const first = rows[0];
      return {
        id,
        titles: [first?.channel_title ?? '', ...rows.map((row) => row.title)],
        brand:
          first && (first.keywords_json !== null || first.description !== null)
            ? { keywords: storedWords(first.keywords_json), description: first.description }
            : null,
      };
    }),
  );
}

/** Strongest first; unscored after, most viewed first among them. */
const strongestFirst = (a: BankVideo, b: BankVideo): number =>
  (b.score ?? -1) - (a.score ?? -1) || b.views - a.views || a.videoId.localeCompare(b.videoId);

/** The bank from the view's rows. */
export function buildBank(rows: readonly BankRow[], context: BankContext, now: Date): Bank {
  const groups = groupByChannel(rows);
  const topics = topicsOf(groups);
  const videos = [...groups.entries()].flatMap(([id, group]) => {
    const channel = channelOf(group, topics.get(id) ?? OTHER, context);
    return channel ? videosOf(group, channel, now) : [];
  });
  return { builtAt: now.toISOString(), videos: [...videos].sort(strongestFirst) };
}

export interface BankReaderDeps {
  readonly now: () => Date;
  /** What a build needs besides the rows, worked out once per build. */
  readonly context: () => BankContext;
}

export interface BankReader {
  /** The bank as the store holds it now; built again only when the store has changed. */
  read(): Bank;
}

/** Ages are counted from the build; a bank older than this is built again even if nothing changed. */
const MAX_BANK_AGE_MS = 60 * 60 * 1000;

export function createBankReader(db: Db, deps: BankReaderDeps): BankReader {
  let kept: { readonly fingerprint: string; readonly bank: Bank } | null = null;
  return {
    read() {
      const fingerprint = bankFingerprint(db);
      const now = deps.now();
      const fresh =
        kept !== null &&
        kept.fingerprint === fingerprint &&
        now.getTime() - new Date(kept.bank.builtAt).getTime() < MAX_BANK_AGE_MS;
      if (fresh && kept) return kept.bank;
      const bank = buildBank(loadBankRows(db), deps.context(), now);
      kept = { fingerprint, bank };
      return bank;
    },
  };
}
