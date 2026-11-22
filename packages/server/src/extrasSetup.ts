/**
 * The later features on this engine's store, built from the engine's wiring
 * so that the engine registers them in one line.
 */
import {
  SqliteAlertRepo,
  SqliteCommentRepo,
  SqliteLookRepo,
  SqliteMoneyRepo,
  SqliteRiskRepo,
  SqliteScheduleRepo,
  SqliteThumbReviewRepo,
  SqliteVideoLinkRepo,
  SqliteVideoPageRepo,
  SqliteVideoRepo,
  ingestChannel,
  transactionRunner,
  type BrandRepo,
  type ChangesDeps,
  type ConceptRepo,
  type Db,
  type ScriptRepo,
  type WatchPageSource,
  type YouTubeSource,
} from '@jgtube/core';
import { alertsEngine } from './alertsEngine';
import type { Engine } from './app';
import { calendarEngine } from './calendarEngine';
import { commentsEngine } from './commentsEngine';
import { changesEngine } from './changesEngine';
import type { ExtrasEngine } from './extrasTypes';
import { moneyEngine } from './moneyEngine';
import { pacingEngine } from './pacingEngine';
import { planEngine } from './planEngine';
import { profileEngine } from './profileEngine';
import { riskEngine } from './riskEngine';
import { thumbReviewEngine } from './thumbReviewEngine';

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
  readonly lazySource: YouTubeSource & WatchPageSource;
  /** Runs work that reads YouTube under the store's lease. */
  readonly reading: <T>(work: () => Promise<T>) => Promise<T>;
  /** The settings as they are now: the YouTube API key is read from here at each use. */
  readonly config: { readonly youtubeApiKey?: string | undefined };
  /** Puts a fixed question to the first AI engine that can run. */
  readonly analyse: Engine['analyse'];
}

export function extras(deps: ExtrasDeps): ExtrasEngine {
  const { db, now, repos, lazySource, reading, config, analyse } = deps;
  const all = {
    ...repos,
    looks: new SqliteLookRepo(db),
    alerts: new SqliteAlertRepo(db),
    links: new SqliteVideoLinkRepo(db),
    // The stored video's own reader, which can find one video by its id.
    videos: new SqliteVideoRepo(db),
    schedule: new SqliteScheduleRepo(db),
    transcripts: new SqliteVideoPageRepo(db),
    comments: new SqliteCommentRepo(db),
    risks: new SqliteRiskRepo(db),
    thumbReviews: new SqliteThumbReviewRepo(db),
    money: new SqliteMoneyRepo(db),
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
    ...calendarEngine({ now, repos: all }),
    ...pacingEngine({ now, repos: all }),
    ...commentsEngine({ now, repos: all, apiKey: () => config.youtubeApiKey, analyse }),
    ...riskEngine({ now, repos: all, analyse }),
    ...profileEngine({ now, repos: all }),
    ...thumbReviewEngine({ now, repos: all, analyse }),
    ...moneyEngine({ now, repos: all, source: lazySource, reading }),
  };
}
