import type { Db } from '../db/sqlite';
import { VIDEO_ID_PATTERN } from '../sources/parse';
import type {
  NewVideoStudy,
  StoredVideoStudy,
  StudiedFrames,
  StudyKind,
  VideoStudyRepo,
} from './types';

/**
 * What an engine wrote down about one video, one row per video and kind:
 * 'watch' is what it saw and heard watching the whole video, 'frames' is what
 * the video's preview frames show from start to end. A watch costs a download
 * and up to twelve minutes and a frame study costs a run of its own, so both
 * are kept and neither is done twice.
 *
 * A study is a model's words about a video anyone could have made. It is
 * stored and handed out as it is, and it is for whoever reads it to treat it
 * as a description, never as instructions.
 */

export const STUDY_KINDS: readonly StudyKind[] = ['watch', 'frames'];
/**
 * The most characters kept for one study. Notes on a twenty-minute video run
 * to a few thousand words; anything far beyond that is not a study.
 */
export const MAX_STUDY_CHARS = 60_000;
const MAX_ENGINE_NAME_LENGTH = 40;

interface StudyRow {
  video_id: string;
  kind: string;
  engine: string;
  notes: string;
  frame_source: string | null;
  frames_available: number | null;
  studied_at: string;
}

/** What a row says about the frames a study was made from; null when it says nothing usable. */
function framesOf(row: StudyRow): StudiedFrames | null {
  const { frame_source: source, frames_available: available } = row;
  if ((source !== 'file' && source !== 'preview') || available === null || available < 1) {
    return null;
  }
  return { source, available };
}

export class SqliteVideoStudyRepo implements VideoStudyRepo {
  constructor(private readonly db: Db) {}

  find(videoId: string, kind: StudyKind): StoredVideoStudy | null {
    const row = this.db
      .prepare<[string, string], StudyRow>(
        `SELECT video_id, kind, engine, notes, frame_source, frames_available, studied_at
         FROM video_studies WHERE video_id = ? AND kind = ?`,
      )
      .get(videoId, kind);
    if (!row) return null;
    const studiedAt = new Date(row.studied_at);
    // A row something else wrote badly is no study at all, not a crash.
    if (Number.isNaN(studiedAt.getTime()) || row.notes.trim() === '') return null;
    return {
      videoId: row.video_id,
      kind,
      engine: row.engine,
      text: row.notes,
      frames: framesOf(row),
      studiedAt,
    };
  }

  save(study: NewVideoStudy, studiedAt: Date): void {
    if (!VIDEO_ID_PATTERN.test(study.videoId)) {
      throw new Error(`Not a valid YouTube video id: "${study.videoId.slice(0, 40)}"`);
    }
    if (!STUDY_KINDS.includes(study.kind)) throw new Error('Not a kind of study');
    const engine = study.engine.trim();
    if (engine === '' || engine.length > MAX_ENGINE_NAME_LENGTH) {
      throw new Error('A study needs the name of the engine that made it');
    }
    if (study.text.trim() === '') throw new Error('A study cannot be empty');
    this.db
      .prepare(
        `INSERT INTO video_studies
           (video_id, kind, engine, notes, frame_source, frames_available, studied_at)
         VALUES (@videoId, @kind, @engine, @notes, @source, @available, @studiedAt)
         ON CONFLICT (video_id, kind) DO UPDATE SET
           engine = excluded.engine,
           notes = excluded.notes,
           frame_source = excluded.frame_source,
           frames_available = excluded.frames_available,
           studied_at = excluded.studied_at`,
      )
      .run({
        videoId: study.videoId,
        kind: study.kind,
        engine,
        notes: study.text.slice(0, MAX_STUDY_CHARS),
        source: study.frames?.source ?? null,
        available: study.frames?.available ?? null,
        studiedAt: studiedAt.toISOString(),
      });
  }
}
