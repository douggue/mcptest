import type { Db } from '../db/sqlite';
import { CHANNEL_ID_PATTERN } from '../sources/parse';
import type { ChannelNoteKind, ChannelNoteRepo, StoredChannelNote } from './types';

/**
 * What an AI engine wrote for a channel that is kept to be read again: its
 * thumbnail review, a quick analysis's answer, the style lock lifted out of
 * its breakdown. One row per channel and kind; a new run replaces it.
 *
 * A note is a model's words. It is stored and handed out as it is, and it is
 * for whoever reads it to treat it as a study, never as instructions.
 */

export const CHANNEL_NOTE_KINDS = [
  'thumbnail-review',
  'video-ideas',
  'near-misses',
  'style-lock',
] as const satisfies readonly ChannelNoteKind[];

/** The most characters kept for one note: far past the longest answer asked for. */
export const MAX_NOTE_CHARS = 40_000;
const MAX_ENGINE_NAME_LENGTH = 40;

interface NoteRow {
  channel_id: string;
  kind: string;
  engine: string;
  notes: string;
  written_at: string;
}

const isKind = (kind: string): kind is ChannelNoteKind =>
  (CHANNEL_NOTE_KINDS as readonly string[]).includes(kind);

export class SqliteChannelNoteRepo implements ChannelNoteRepo {
  constructor(private readonly db: Db) {}

  find(channelId: string, kind: ChannelNoteKind): StoredChannelNote | null {
    const row = this.db
      .prepare<[string, string], NoteRow>(
        `SELECT channel_id, kind, engine, notes, written_at FROM channel_notes
         WHERE channel_id = ? AND kind = ?`,
      )
      .get(channelId, kind);
    const writtenAt = row ? new Date(row.written_at) : null;
    if (!row || writtenAt === null || Number.isNaN(writtenAt.getTime()) || !isKind(row.kind)) {
      return null;
    }
    return {
      channelId: row.channel_id,
      kind: row.kind,
      engine: row.engine,
      text: row.notes,
      writtenAt,
    };
  }

  save(
    note: Pick<StoredChannelNote, 'channelId' | 'kind' | 'engine' | 'text'>,
    writtenAt: Date,
  ): void {
    if (!CHANNEL_ID_PATTERN.test(note.channelId)) {
      throw new Error(`Not a valid YouTube channel id: "${note.channelId.slice(0, 40)}"`);
    }
    if (!isKind(note.kind)) throw new Error('Not a kind of note');
    const engine = note.engine.trim();
    if (engine === '' || engine.length > MAX_ENGINE_NAME_LENGTH) {
      throw new Error('A note needs the name of the engine that wrote it');
    }
    if (note.text.trim() === '') throw new Error('A note cannot be empty');
    this.db
      .prepare(
        `INSERT INTO channel_notes (channel_id, kind, engine, notes, written_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (channel_id, kind) DO UPDATE SET
           engine = excluded.engine, notes = excluded.notes, written_at = excluded.written_at`,
      )
      .run(
        note.channelId,
        note.kind,
        engine,
        note.text.slice(0, MAX_NOTE_CHARS),
        writtenAt.toISOString(),
      );
  }

  remove(channelId: string, kind: ChannelNoteKind): void {
    this.db
      .prepare('DELETE FROM channel_notes WHERE channel_id = ? AND kind = ?')
      .run(channelId, kind);
  }
}
