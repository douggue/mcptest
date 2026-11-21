/**
 * The later features on this engine's store, built from the engine's wiring
 * so that the engine registers them in one line.
 */
import {
  SqliteAlertRepo,
  SqliteLookRepo,
  SqliteVideoLinkRepo,
  SqliteVideoRepo,
  ingestChannel,
  transactionRunner,
  type BrandRepo,
  type ChangesDeps,
  type ConceptRepo,
  type Db,
  type ScriptRepo,
  type YouTubeSource,
} from '@jgtube/core';
import { alertsEngine } from './alertsEngine';
import { changesEngine } from './changesEngine';
import type { ExtrasEngine } from './extrasTypes';
import { planEngine } from './planEngine';

export interface ExtrasDeps {
  readonly db: Db;
  readonly now: () => Date;
  /** The repositories the engine already holds. */
  readonly repos: Omit<ChangesDeps, 'looks'> & {
    readonly concepts: ConceptRepo;
    readonly scripts: ScriptRepo;
    readonly brands?: BrandRepo;
  };
  /** YouTube, connected on first use. */
  readonly lazySource: YouTubeSource;
  /** Runs work that reads YouTube under the store's lease. */
  readonly reading: <T>(work: () => Promise<T>) => Promise<T>;
}

export function extras({ db, now, repos, lazySource, reading }: ExtrasDeps): ExtrasEngine {
  const all = {
    ...repos,
    looks: new SqliteLookRepo(db),
    alerts: new SqliteAlertRepo(db),
    links: new SqliteVideoLinkRepo(db),
    // The stored video's own reader, which can find one video by its id.
    videos: new SqliteVideoRepo(db),
  };
  const readChannel = (channelId: string): Promise<void> =>
    reading(async () => {
      const ingest = { ...repos, source: lazySource, transact: transactionRunner(db), now };
      await ingestChannel(ingest, channelId, { refresh: true });
    });
  return {
    ...changesEngine({ now, repos: all }),
    ...alertsEngine({ now, repos: all }),
    ...planEngine({ now, repos: all, readChannel }),
  };
}
