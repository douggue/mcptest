/**
 * The last picture check of each engine, kept in a small file beside the
 * store (what the engines are like on this computer, as the engine status
 * is, not research). A file that is missing, unreadable or holds anything
 * else counts as no check run, which changes nothing: only a failed check
 * keeps an engine from the picture questions.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
import { ENGINE_IDS } from './engines/settings';
import type { EngineId } from './engines/types';

const IN_MEMORY = ':memory:';
const SUFFIX = '.picture-checks.json';
const OWNER_ONLY = 0o600;
/** An answer is a short line; anything longer is cut before it is kept or shown. */
export const MAX_ANSWER_LENGTH = 300;

const recordSchema = z.object({
  engine: z.enum(ENGINE_IDS),
  passed: z.boolean(),
  answer: z.string().max(MAX_ANSWER_LENGTH),
  shown: z.array(z.string().max(20)).max(2),
  checkedAt: z.string().max(40),
});
const fileSchema = z.object({ checks: z.array(recordSchema).max(ENGINE_IDS.length) });

export type PictureCheckRecord = z.infer<typeof recordSchema>;

export interface PictureChecks {
  /** The last check of each engine that has been checked. */
  all(): readonly PictureCheckRecord[];
  /** The engines whose last check passed. */
  passed(): readonly EngineId[];
  /** The engines whose last check failed: the only ones kept from the picture questions. */
  failed(): readonly EngineId[];
  /** Keeps a result, replacing the engine's earlier one. */
  record(result: PictureCheckRecord): void;
}

/** Where the results are kept for a store; null for a store only in memory. */
export const pictureChecksPath = (storePath: string): string | null =>
  storePath === IN_MEMORY ? null : `${storePath}${SUFFIX}`;

function readChecks(path: string | null): readonly PictureCheckRecord[] {
  if (path === null) return [];
  try {
    const parsed = fileSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')));
    return parsed.success ? parsed.data.checks : [];
  } catch {
    return [];
  }
}

function writeChecks(path: string, checks: readonly PictureCheckRecord[]): void {
  const temporary = `${path}.tmp-${randomUUID()}`;
  writeFileSync(temporary, JSON.stringify({ checks }), { mode: OWNER_ONLY });
  renameSync(temporary, path);
}

/** The results kept at `path`, or in memory alone when it is null. */
export function pictureChecks(path: string | null): PictureChecks {
  let kept = readChecks(path);
  return {
    all: () => kept,
    passed: () => kept.filter((check) => check.passed).map((check) => check.engine),
    failed: () => kept.filter((check) => !check.passed).map((check) => check.engine),
    record(result) {
      const next = [...kept.filter((check) => check.engine !== result.engine), result];
      if (path !== null) writeChecks(path, next);
      kept = next;
    },
  };
}
