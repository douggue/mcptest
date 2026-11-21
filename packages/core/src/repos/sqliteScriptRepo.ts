import type { Db } from '../db/sqlite';
import {
  EMPTY_SCRIPT,
  MAX_HOOK_MODELS,
  SCRIPT_STATUSES,
  type ScriptFields,
  type ScriptHook,
  type ScriptRepo,
  type StoredScript,
} from '../script/types';
import { VIDEO_ID_PATTERN } from '../sources/parse';

/**
 * Scripts, one per concept. A script is found and changed only through the
 * centre channel its concept was written for, so one channel's script can
 * never be read or overwritten for another.
 *
 * The hooks, the draft and the tightened draft are a model's words, edited
 * by the owner. They are stored as written, and are for whoever reads them
 * to treat as text, never as instructions.
 */

/**
 * The most characters one text of a script may hold. A half-hour video is
 * about 4,500 words, some 30,000 characters with its cues; anything far past
 * that is not a script.
 */
export const MAX_SCRIPT_CHARS = 120_000;
/** Faster than anyone speaks: a bound on what is stored, not a judgement. */
const MAX_WORDS_PER_MINUTE = 400;
const MAX_TARGET_SECONDS = 4 * 60 * 60;

interface ScriptRow {
  concept_id: number;
  center_channel_id: string;
  status: string;
  voice_channel_id: string | null;
  words_per_minute: number | null;
  target_seconds: number | null;
  target_grade: number | null;
  hook_models_json: string;
  hooks_json: string;
  chosen_hook: string;
  beats: string;
  draft: string;
  tightened: string;
  updated_at: string;
}

/** Stored JSON as a list; anything else is no list at all. */
function listOf(json: string): readonly unknown[] {
  try {
    const value: unknown = JSON.parse(json);
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

const isText = (value: unknown): value is string => typeof value === 'string';

function hooksOf(json: string): readonly ScriptHook[] {
  return listOf(json).flatMap((entry): ScriptHook[] => {
    if (typeof entry !== 'object' || entry === null) return [];
    const { way, model, text } = entry as Record<string, unknown>;
    if (!isText(way) || !isText(text)) return [];
    return [{ way, model: isText(model) && VIDEO_ID_PATTERN.test(model) ? model : null, text }];
  });
}

function toScript(row: ScriptRow): StoredScript {
  return {
    conceptId: row.concept_id,
    centerChannelId: row.center_channel_id,
    status: SCRIPT_STATUSES.find((status) => status === row.status) ?? 'idea',
    voiceChannelId: row.voice_channel_id,
    wordsPerMinute: row.words_per_minute,
    targetSeconds: row.target_seconds,
    targetGrade: row.target_grade,
    hookModels: listOf(row.hook_models_json).filter(
      (id): id is string => isText(id) && VIDEO_ID_PATTERN.test(id),
    ),
    hooks: hooksOf(row.hooks_json),
    chosenHook: row.chosen_hook,
    beats: row.beats,
    draft: row.draft,
    tightened: row.tightened,
    updatedAt: new Date(row.updated_at),
  };
}

const inRange = (value: number | null, max: number): boolean =>
  value === null || (Number.isFinite(value) && value > 0 && value <= max);

/** Throws, in plain words, for a script that could not be one. */
function check(script: ScriptFields): void {
  if (!SCRIPT_STATUSES.includes(script.status)) throw new Error('Not a status a script can have');
  if (script.hookModels.some((id) => !VIDEO_ID_PATTERN.test(id))) {
    throw new Error('A hook to model is named by its video id');
  }
  if (script.hookModels.length > MAX_HOOK_MODELS) {
    throw new Error('A script can model at most three hooks');
  }
  if (!inRange(script.wordsPerMinute, MAX_WORDS_PER_MINUTE)) {
    throw new Error('That is not a speaking rate');
  }
  if (!inRange(script.targetSeconds, MAX_TARGET_SECONDS)) throw new Error('That is not a length');
  const texts = [script.chosenHook, script.beats, script.draft, script.tightened];
  if (texts.some((text) => text.length > MAX_SCRIPT_CHARS)) {
    throw new Error('That text is too long to be a script');
  }
}

const SELECT = `SELECT s.*, b.center_channel_id FROM scripts s
  JOIN concepts c ON c.id = s.concept_id JOIN concept_batches b ON b.id = c.batch_id`;

export class SqliteScriptRepo implements ScriptRepo {
  constructor(private readonly db: Db) {}

  find(centerChannelId: string, conceptId: number): StoredScript | null {
    const row = this.db
      .prepare<[number, string], ScriptRow>(
        `${SELECT} WHERE s.concept_id = ? AND b.center_channel_id = ?`,
      )
      .get(conceptId, centerChannelId);
    return row ? toScript(row) : null;
  }

  save(
    centerChannelId: string,
    conceptId: number,
    changes: Partial<ScriptFields>,
    updatedAt: Date,
  ): boolean {
    const next: ScriptFields = {
      ...(this.find(centerChannelId, conceptId) ?? EMPTY_SCRIPT),
      ...changes,
    };
    check(next);
    return this.db.transaction((): boolean => {
      const kept = this.db
        .prepare(
          `UPDATE concepts SET kept = 1 WHERE id = ? AND batch_id IN
             (SELECT id FROM concept_batches WHERE center_channel_id = ?)`,
        )
        .run(conceptId, centerChannelId);
      if (kept.changes === 0) return false;
      this.db
        .prepare(
          `INSERT OR REPLACE INTO scripts
             (concept_id, status, voice_channel_id, words_per_minute, target_seconds, target_grade,
              hook_models_json, hooks_json, chosen_hook, beats, draft, tightened, updated_at)
           VALUES (@conceptId, @status, @voice, @wpm, @seconds, @grade, @models, @hooks,
                   @chosenHook, @beats, @draft, @tightened, @updatedAt)`,
        )
        .run({
          conceptId,
          status: next.status,
          voice: next.voiceChannelId,
          wpm: next.wordsPerMinute === null ? null : Math.round(next.wordsPerMinute),
          seconds: next.targetSeconds === null ? null : Math.round(next.targetSeconds),
          grade: next.targetGrade,
          models: JSON.stringify(next.hookModels),
          hooks: JSON.stringify(next.hooks),
          chosenHook: next.chosenHook,
          beats: next.beats,
          draft: next.draft,
          tightened: next.tightened,
          updatedAt: updatedAt.toISOString(),
        });
      return true;
    })();
  }

  list(
    centerChannelId: string,
  ): readonly Pick<StoredScript, 'conceptId' | 'status' | 'updatedAt'>[] {
    return this.db
      .prepare<[string], ScriptRow>(`${SELECT} WHERE b.center_channel_id = ? ORDER BY s.concept_id`)
      .all(centerChannelId)
      .map(toScript)
      .map(({ conceptId, status, updatedAt }) => ({ conceptId, status, updatedAt }));
  }
}
