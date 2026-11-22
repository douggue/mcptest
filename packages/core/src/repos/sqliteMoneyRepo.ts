import type { Db } from '../db/sqlite';
import type { StoredMoneySigns } from '../money/verdict';
import type { AdsSeen } from '../money/watchSigns';
import { CHANNEL_ID_PATTERN, VIDEO_ID_PATTERN } from '../sources/parse';
import type { MoneyRepo } from './types';

interface MoneyRow {
  channel_id: string;
  video_id: string;
  memberships: number;
  ads: string;
  checked_at: string;
}

const ADS: ReadonlySet<string> = new Set<AdsSeen>(['shown', 'none', 'unknown']);
/** SQLite allows 999 bound values in one statement on older builds; stay well under. */
const MAX_IDS_PER_READ = 500;

const toSigns = (row: MoneyRow): StoredMoneySigns => ({
  channelId: row.channel_id,
  videoId: row.video_id,
  memberships: row.memberships === 1,
  ads: ADS.has(row.ads) ? (row.ads as AdsSeen) : 'unknown',
  checkedAt: new Date(row.checked_at),
});

const COLUMNS = 'channel_id, video_id, memberships, ads, checked_at';

/** The public signs of earning, kept in their own table (step 42, provisional). */
export class SqliteMoneyRepo implements MoneyRepo {
  constructor(private readonly db: Db) {}

  find(channelId: string): StoredMoneySigns | null {
    const row = this.db
      .prepare<[string], MoneyRow>(
        `SELECT ${COLUMNS} FROM channel_money_signs WHERE channel_id = ?`,
      )
      .get(channelId);
    return row ? toSigns(row) : null;
  }

  findMany(channelIds: readonly string[]): ReadonlyMap<string, StoredMoneySigns> {
    const rows: MoneyRow[] = [];
    for (let start = 0; start < channelIds.length; start += MAX_IDS_PER_READ) {
      const ids = channelIds.slice(start, start + MAX_IDS_PER_READ);
      const marks = ids.map(() => '?').join(', ');
      rows.push(
        ...this.db
          .prepare<string[], MoneyRow>(
            `SELECT ${COLUMNS} FROM channel_money_signs WHERE channel_id IN (${marks})`,
          )
          .all(...ids),
      );
    }
    return new Map(rows.map((row) => [row.channel_id, toSigns(row)]));
  }

  save(signs: StoredMoneySigns): void {
    if (!CHANNEL_ID_PATTERN.test(signs.channelId)) throw new Error('Not a channel id');
    if (!VIDEO_ID_PATTERN.test(signs.videoId)) throw new Error('Not a video id');
    this.db
      .prepare(
        `INSERT INTO channel_money_signs (${COLUMNS}) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (channel_id) DO UPDATE SET
           video_id = excluded.video_id,
           memberships = excluded.memberships,
           ads = excluded.ads,
           checked_at = excluded.checked_at`,
      )
      .run(
        signs.channelId,
        signs.videoId,
        signs.memberships ? 1 : 0,
        signs.ads,
        signs.checkedAt.toISOString(),
      );
  }
}
