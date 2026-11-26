/**
 * Reads of the store kept until the store changes. A read that takes a
 * quarter of a second (a map, the thumbnail board, the transfer list) is
 * worked out once and then answered from memory, until something is written:
 * the store's change counter (`storeVersion`) then reads differently and the
 * next read works it out again. Nothing is kept longer than `maxAgeMs` either,
 * since some answers count days from now.
 */
import type { Db } from '@jgtube/core';

/** Ten minutes: ages counted from now move little in that time. */
export const READ_MAX_AGE_MS = 10 * 60 * 1000;
const MAX_ENTRIES = 64;

/**
 * A cheap number that changes whenever the store does: SQLite's
 * `data_version` (writes by any other connection: the connector, the command
 * line) with `total_changes()` (writes by this one). Costs microseconds.
 */
export function storeVersion(db: Db): () => string {
  const changes = db.prepare<[], number>('SELECT total_changes()').pluck();
  return () => `${String(db.pragma('data_version', { simple: true }))}.${changes.get() ?? 0}`;
}

export interface VersionedOptions {
  /** Changes whenever what is kept may have changed. */
  readonly version: () => string;
  readonly now?: () => number;
  readonly maxAgeMs?: number;
  readonly maxEntries?: number;
}

interface Kept<T> {
  readonly version: string;
  readonly at: number;
  readonly value: T;
}

export interface Versioned {
  /** The kept value for `key` while the version holds; otherwise works it out and keeps it. */
  get<T>(key: string, compute: () => T): T;
  /** Forgets everything kept. */
  clear(): void;
}

export function versioned(options: VersionedOptions): Versioned {
  const now = options.now ?? (() => Date.now());
  const maxAgeMs = options.maxAgeMs ?? READ_MAX_AGE_MS;
  const maxEntries = options.maxEntries ?? MAX_ENTRIES;
  const kept = new Map<string, Kept<unknown>>();
  return {
    get<T>(key: string, compute: () => T): T {
      const version = options.version();
      const found = kept.get(key);
      if (found && found.version === version && now() - found.at < maxAgeMs) {
        return found.value as T;
      }
      const value = compute();
      // A read that wrote as it went is not kept: what it found may already be old.
      if (options.version() !== version) return value;
      kept.delete(key);
      kept.set(key, { version, at: now(), value });
      if (kept.size > maxEntries) {
        const oldest = kept.keys().next().value;
        if (oldest !== undefined) kept.delete(oldest);
      }
      return value;
    },
    clear: () => kept.clear(),
  };
}
