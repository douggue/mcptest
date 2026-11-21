/**
 * The later features on this engine's store, built from the open store so
 * that the engine registers them in one line.
 */
import { SqliteAlertRepo, SqliteLookRepo, type ChangesDeps, type Db } from '@jgtube/core';
import { alertsEngine } from './alertsEngine';
import { changesEngine } from './changesEngine';
import type { ExtrasEngine } from './extrasTypes';

export interface ExtrasDeps {
  readonly db: Db;
  readonly now: () => Date;
  /** The repositories the engine already holds. */
  readonly repos: Omit<ChangesDeps, 'looks'>;
}

export function extras({ db, now, repos }: ExtrasDeps): ExtrasEngine {
  const all = { ...repos, looks: new SqliteLookRepo(db), alerts: new SqliteAlertRepo(db) };
  return { ...changesEngine({ now, repos: all }), ...alertsEngine({ now, repos: all }) };
}
