import { transactionRunner, type Db } from '../db/sqlite';
import { SqliteChannelRepo } from './sqliteChannelRepo';
import { SqliteReadingRepo } from './sqliteReadingRepo';
import { SqliteSubjectHitRepo, SqliteSubjectRepo } from './sqliteSubjectRepo';
import { SqliteTrackingRepo } from './sqliteTrackingRepo';
import { SqliteVideoRepo } from './sqliteVideoRepo';
import type { Store } from './types';

/** Every repository the cycles write to, over one open store. */
export function openStore(db: Db): Store {
  return {
    channels: new SqliteChannelRepo(db),
    videos: new SqliteVideoRepo(db),
    readings: new SqliteReadingRepo(db),
    subjects: new SqliteSubjectRepo(db),
    hits: new SqliteSubjectHitRepo(db),
    tracking: new SqliteTrackingRepo(db),
    transact: transactionRunner(db),
  };
}
