import { transactionRunner, type Db } from '../db/sqlite';
import { SqliteChannelRepo } from './sqliteChannelRepo';
import { SqliteFindingRepo } from './sqliteFindingRepo';
import { SqliteFollowRepo } from './sqliteFollowRepo';
import { SqliteGrowthRepo } from './sqliteGrowthRepo';
import { SqliteReadingRepo } from './sqliteReadingRepo';
import { SqlitePassedOverRepo, SqlitePendingHitRepo } from './sqliteSearchMemoryRepo';
import { SqliteServiceStateRepo } from './sqliteServiceStateRepo';
import { SqliteSubjectHitRepo, SqliteSubjectRepo } from './sqliteSubjectRepo';
import { SqliteTrackingRepo } from './sqliteTrackingRepo';
import { SqliteVideoRepo } from './sqliteVideoRepo';
import type { Store } from './types';

/** Every repository the cycles write to, over one open store. */
export function openStore(db: Db): Store {
  return {
    channels: new SqliteChannelRepo(db),
    follows: new SqliteFollowRepo(db),
    videos: new SqliteVideoRepo(db),
    readings: new SqliteReadingRepo(db),
    growth: new SqliteGrowthRepo(db),
    subjects: new SqliteSubjectRepo(db),
    hits: new SqliteSubjectHitRepo(db),
    pending: new SqlitePendingHitRepo(db),
    passedOver: new SqlitePassedOverRepo(db),
    tracking: new SqliteTrackingRepo(db),
    findings: new SqliteFindingRepo(db),
    state: new SqliteServiceStateRepo(db),
    transact: transactionRunner(db),
  };
}
