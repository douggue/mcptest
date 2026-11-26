/**
 * What the last check found about the programs, kept in a small file beside
 * the store (what the computer is like, as the picture checks are, not
 * research), so the page has an answer the moment Jgtube starts. A file that
 * is missing, unreadable or holds anything else counts as no check run.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
import type { Found } from './lastKnown';
import { ENGINE_IDS } from './settings';
import type { EngineStatus } from './types';

const IN_MEMORY = ':memory:';
const SUFFIX = '.engine-status.json';
const OWNER_ONLY = 0o600;
const MAX_TEXT = 400;

const text = z.string().max(MAX_TEXT);
const statusSchema = z.object({
  id: z.enum(ENGINE_IDS),
  label: text,
  installed: z.boolean(),
  signedIn: z.boolean().nullable(),
  version: text.nullable(),
  ready: z.boolean(),
  note: text.nullable(),
});
const fileSchema = z.object({
  at: z.number().finite(),
  value: z.array(statusSchema).max(ENGINE_IDS.length),
});

/** The file beside a store on disk; none for a store in memory. */
export const engineStatusPath = (storePath: string): string | null =>
  storePath === IN_MEMORY ? null : `${storePath}${SUFFIX}`;

export function readStatusFile(path: string | null): Found<readonly EngineStatus[]> | null {
  if (path === null) return null;
  try {
    const parsed = fileSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function writeStatusFile(path: string | null, found: Found<readonly EngineStatus[]>): void {
  if (path === null) return;
  const temporary = `${path}.tmp-${randomUUID()}`;
  writeFileSync(temporary, JSON.stringify(found), { mode: OWNER_ONLY });
  renameSync(temporary, path);
}
