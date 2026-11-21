import type { Db } from '../db/sqlite';
import type { HookLabel } from '../hooks/hooks';
import { CHANNEL_ID_PATTERN, VIDEO_ID_PATTERN } from '../sources/parse';

/**
 * The name an engine gave to the way one breakout video opens, and its
 * sentence on how that works, kept per centre channel and video. The opening
 * words themselves are not kept here: they are cut from the stored captions
 * each time, so they cannot drift from what the video says.
 *
 * A label is a model's words about a video anyone could have made: stored as
 * written and read as a description, never as instructions.
 */

export interface StoredHookLabel extends HookLabel {
  /** The engine that gave the label, by its id. */
  readonly engine: string;
  readonly labelledAt: Date;
}

export interface HookLabelRepo {
  /** Stores all the labels or none; a video's earlier label for this channel is replaced. */
  saveMany(
    centerChannelId: string,
    labels: readonly HookLabel[],
    engine: string,
    labelledAt: Date,
  ): void;
  /** The channel's labels, by video id. */
  list(centerChannelId: string): readonly StoredHookLabel[];
}

interface LabelRow {
  video_id: string;
  style: string;
  how: string;
  engine: string;
  labelled_at: string;
}

export class SqliteHookLabelRepo implements HookLabelRepo {
  constructor(private readonly db: Db) {}

  saveMany(
    centerChannelId: string,
    labels: readonly HookLabel[],
    engine: string,
    labelledAt: Date,
  ): void {
    if (!CHANNEL_ID_PATTERN.test(centerChannelId)) {
      throw new Error('Hook labels are kept for a channel id');
    }
    if (labels.some((label) => !VIDEO_ID_PATTERN.test(label.videoId))) {
      throw new Error('A hook label is for a video named by its video id');
    }
    if (labels.some((label) => label.style.trim() === '' || label.how.trim() === '')) {
      throw new Error('A hook label needs a style and a sentence on how it works');
    }
    const upsert = this.db.prepare(
      `INSERT INTO hook_labels (center_channel_id, video_id, style, how, engine, labelled_at)
       VALUES (@center, @videoId, @style, @how, @engine, @labelledAt)
       ON CONFLICT (center_channel_id, video_id) DO UPDATE SET
         style = excluded.style,
         how = excluded.how,
         engine = excluded.engine,
         labelled_at = excluded.labelled_at`,
    );
    this.db.transaction(() => {
      for (const label of labels) {
        upsert.run({
          center: centerChannelId,
          videoId: label.videoId,
          style: label.style,
          how: label.how,
          engine,
          labelledAt: labelledAt.toISOString(),
        });
      }
    })();
  }

  list(centerChannelId: string): readonly StoredHookLabel[] {
    return this.db
      .prepare<[string], LabelRow>(
        `SELECT video_id, style, how, engine, labelled_at FROM hook_labels
         WHERE center_channel_id = ? ORDER BY video_id`,
      )
      .all(centerChannelId)
      .map((row) => ({
        videoId: row.video_id,
        style: row.style,
        how: row.how,
        engine: row.engine,
        labelledAt: new Date(row.labelled_at),
      }));
  }
}
