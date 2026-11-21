import type { AlertFinding, AlertKind } from '../alerts/alerts';
import type { AlertRepo, AlertRule, AlertSettings, StoredAlert } from '../alerts/store';
import type { Db } from '../db/sqlite';

interface RuleRow {
  center_channel_id: string;
  min_score: number;
  taken_off: number;
  enabled: number;
  created_at: string;
  checked_at: string;
}

interface AlertRow {
  id: number;
  center_channel_id: string;
  kind: AlertKind;
  subject_id: string;
  channel_id: string;
  channel_title: string;
  video_title: string | null;
  score: number | null;
  views: number | null;
  found_at: string;
  read_at: string | null;
}

const toRule = (row: RuleRow): AlertRule => ({
  centerChannelId: row.center_channel_id,
  minScore: row.min_score,
  takenOff: row.taken_off === 1,
  enabled: row.enabled === 1,
  createdAt: new Date(row.created_at),
  checkedAt: new Date(row.checked_at),
});

const toAlert = (row: AlertRow): StoredAlert => ({
  id: row.id,
  centerChannelId: row.center_channel_id,
  kind: row.kind,
  subjectId: row.subject_id,
  channelId: row.channel_id,
  channelTitle: row.channel_title,
  videoTitle: row.video_title,
  score: row.score,
  views: row.views,
  foundAt: new Date(row.found_at),
  readAt: row.read_at === null ? null : new Date(row.read_at),
});

const RULE_COLUMNS = 'center_channel_id, min_score, taken_off, enabled, created_at, checked_at';

export class SqliteAlertRepo implements AlertRepo {
  constructor(private readonly db: Db) {}

  rule(centerChannelId: string): AlertRule | null {
    const row = this.db
      .prepare<[string], RuleRow>(
        `SELECT ${RULE_COLUMNS} FROM alert_rules WHERE center_channel_id = ?`,
      )
      .get(centerChannelId);
    return row ? toRule(row) : null;
  }

  saveRule(centerChannelId: string, settings: AlertSettings, at: Date): AlertRule {
    const time = at.toISOString();
    this.db
      .prepare(
        `INSERT INTO alert_rules (${RULE_COLUMNS})
         VALUES (@center, @minScore, @takenOff, @enabled, @time, @time)
         ON CONFLICT (center_channel_id) DO UPDATE SET
           min_score = excluded.min_score, taken_off = excluded.taken_off,
           enabled = excluded.enabled`,
      )
      .run({
        center: centerChannelId,
        minScore: settings.minScore,
        takenOff: settings.takenOff ? 1 : 0,
        enabled: settings.enabled ? 1 : 0,
        time,
      });
    const saved = this.rule(centerChannelId);
    if (!saved) throw new Error('The alert rule could not be saved');
    return saved;
  }

  listRules(): readonly AlertRule[] {
    return this.db
      .prepare<[], RuleRow>(
        `SELECT ${RULE_COLUMNS} FROM alert_rules ORDER BY created_at, center_channel_id`,
      )
      .all()
      .map(toRule);
  }

  markChecked(centerChannelId: string, at: Date): void {
    this.db
      .prepare('UPDATE alert_rules SET checked_at = ? WHERE center_channel_id = ?')
      .run(at.toISOString(), centerChannelId);
  }

  add(centerChannelId: string, findings: readonly AlertFinding[], at: Date): number {
    const insert = this.db.prepare(
      `INSERT OR IGNORE INTO alerts (center_channel_id, kind, subject_id, channel_id,
         channel_title, video_title, score, views, found_at)
       VALUES (@center, @kind, @subjectId, @channelId, @channelTitle, @videoTitle, @score,
         @views, @foundAt)`,
    );
    const run = this.db.transaction((): number =>
      findings.reduce(
        (added, finding) =>
          added +
          insert.run({ ...finding, center: centerChannelId, foundAt: at.toISOString() }).changes,
        0,
      ),
    );
    return run();
  }

  list(centerChannelId: string, limit: number): readonly StoredAlert[] {
    return this.db
      .prepare<[string, number], AlertRow>(
        `SELECT * FROM alerts WHERE center_channel_id = ? ORDER BY found_at DESC, id DESC LIMIT ?`,
      )
      .all(centerChannelId, limit)
      .map(toAlert);
  }

  unreadCounts(): ReadonlyMap<string, number> {
    const rows = this.db
      .prepare<[], { center_channel_id: string; unread: number }>(
        `SELECT center_channel_id, COUNT(*) AS unread FROM alerts
         WHERE read_at IS NULL GROUP BY center_channel_id ORDER BY center_channel_id`,
      )
      .all();
    return new Map(rows.map((row) => [row.center_channel_id, row.unread]));
  }

  markRead(centerChannelId: string, at: Date): number {
    return this.db
      .prepare('UPDATE alerts SET read_at = ? WHERE center_channel_id = ? AND read_at IS NULL')
      .run(at.toISOString(), centerChannelId).changes;
  }
}
