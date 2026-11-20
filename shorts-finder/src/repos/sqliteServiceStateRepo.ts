import type { Db } from '../db/sqlite';
import { toText } from './rows';
import type { ServiceStateRepo } from './types';

/** The service's memory between restarts, one row a name. */
export class SqliteServiceStateRepo implements ServiceStateRepo {
  constructor(private readonly db: Db) {}

  get(key: string): string | null {
    const row = this.db
      .prepare<[string], { value: string }>('SELECT value FROM service_state WHERE key = ?')
      .get(key);
    return row?.value ?? null;
  }

  set(key: string, value: string, at: Date): void {
    this.db
      .prepare(
        `INSERT INTO service_state (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT (key) DO UPDATE SET
           value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(key, value, toText(at));
  }
}
