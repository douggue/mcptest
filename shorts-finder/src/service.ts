/**
 * The service put together: the store, the allowance ledger, the official
 * API, the cycles and the loop that runs them. `main.ts` loads the settings
 * and hands them here; tests hand in a clock, a timer and a stand-in for the
 * network.
 */
import { runAlertCycle, type AlertDeps } from './alerts/alertCycle';
import { runDailyMessages } from './alerts/dailyMessages';
import { createSender } from './alerts/telegram';
import type { Config } from './config';
import { openDatabase, type Db } from './db/sqlite';
import { detailChannelFinds, NO_FINDS, type FindsReport } from './discover/channelFinds';
import { readQueuedChannels } from './discover/channelReads';
import { runFeedCycle, type ReadFeed } from './discover/feedCycle';
import { runUploadsCycle } from './discover/followedUploads';
import { runSearchCycle } from './discover/searchCycle';
import { ReadingElsewhereError, withYouTubeLease, type LeaseDeps } from './lease';
import type { Logger } from './log';
import { createQuotaLedger, planFor } from './quota/ledger';
import { SqliteLeaseRepo } from './repos/sqliteLeaseRepo';
import { SqliteQuotaRepo } from './repos/sqliteQuotaRepo';
import { openStore } from './repos/store';
import type { Store } from './repos/types';
import {
  startScheduler,
  type CycleRecord,
  type Scheduler,
  type SchedulerDeps,
  type SchedulerMemory,
} from './schedule/scheduler';
import { gatherStats, noteOutcome } from './status';
import { DETAILS_COST_UNITS, pickDueSubjects } from './subjects/due';
import { runDailyCleanup } from './track/cleanup';
import { runReadCycle } from './track/readCycle';
import { createYouTubeApi } from './youtube/api';
import { fetchFeed, shortsFeedUrl } from './youtube/feed';

export interface ServiceDeps {
  readonly log: Logger;
  readonly now?: () => Date;
  /** Replaces the network, for YouTube and for Telegram; used by tests. */
  readonly fetch?: typeof fetch;
  /** Replace the scheduler's timer; used by tests. */
  readonly every?: SchedulerDeps['every'];
  readonly stop?: SchedulerDeps['stop'];
}

export interface Service {
  /** Stops the loop, waits for work that is running, then closes the store. */
  stop(): Promise<void>;
  /** Resolves when no work is running. */
  whenIdle(): Promise<void>;
}

const ALERTS_OFF =
  'Alerts are off: TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are not set. Findings are kept in the store.';

type Messages = Pick<SchedulerDeps, 'alertCycle' | 'dailyMessages'>;

/** The owner's messages, or none (said once) when Telegram is not set up. */
function messagesFor(
  config: Config,
  store: Store,
  deps: ServiceDeps,
  now: () => Date,
  db: Db,
): Messages {
  if (config.telegram === null) {
    deps.log.info('alerts_off', { message: ALERTS_OFF });
    return {};
  }
  const alerts: AlertDeps = {
    findings: store.findings,
    state: store.state,
    send: createSender({ ...config.telegram, fetch: deps.fetch }),
    now,
    settings: {
      maxPerDay: config.maxAlertsPerDay,
      digestHour: config.digestHour,
      timeZone: config.timeZone,
      rate: config.shortsRate,
    },
  };
  const sources = {
    quota: new SqliteQuotaRepo(db),
    tracking: store.tracking,
    state: store.state,
    dbPath: config.dbPath,
    dailyUnits: config.dailyUnits,
  };
  return {
    alertCycle: () => runAlertCycle(alerts),
    dailyMessages: () => runDailyMessages({ ...alerts, stats: (at) => gatherStats(sources, at) }),
  };
}

/** Every outcome goes to the log and into the store, where `status` reads it. */
const recorder =
  (store: Store, log: Logger, now: () => Date) =>
  (entry: CycleRecord): void => {
    const fields = { cycle: entry.cycle, result: entry.result, reason: entry.reason };
    if (entry.result === 'failed') log.error('cycle', fields);
    else log.info('cycle', { ...fields, report: entry.report });
    noteOutcome(store.state, entry, now());
  };

/** The loop over the real cycles, all reading and writing one open store. */
function schedulerOver(config: Config, deps: ServiceDeps, now: () => Date, db: Db): Scheduler {
  const store = openStore(db);
  const ledger = createQuotaLedger({
    repo: new SqliteQuotaRepo(db),
    plan: planFor(config.dailyUnits),
    now,
  });
  const api = createYouTubeApi({
    apiKey: config.youtubeApiKey,
    spend: ledger.spend,
    fetch: deps.fetch,
  });
  const cycle = { api, ledger, store, now, follow: config.follow };
  const lease: LeaseDeps = { leases: new SqliteLeaseRepo(db), now };
  const memory: SchedulerMemory = {
    get: (key) => store.state.get(key),
    set: (key, value) => store.state.set(key, value, now()),
  };
  const readFeed: ReadFeed = (channelId, validators, signal) =>
    fetchFeed(shortsFeedUrl(channelId), {
      fetch: deps.fetch,
      ...(validators === null ? {} : { validators }),
      ...(signal === undefined ? {} : { signal }),
    });
  return startScheduler({
    lease,
    now,
    readCycle: (signal) => runReadCycle(cycle, signal),
    channelReads: (signal) => readQueuedChannels(cycle, signal),
    uploadsCycle: (signal) => runUploadsCycle(cycle, signal),
    feedCycle: (signal) =>
      runFeedCycle({ store, now, readFeed, detail: feedDetails(cycle, lease) }, signal),
    searchCycle: (signal) => runSearchCycle(cycle, signal),
    searchIsDue: (at) => {
      const left = ledger.remaining(at).byKind.search;
      // Results still waiting for their details are work for a round as well.
      const waiting = store.pending.count() > 0 && left >= DETAILS_COST_UNITS;
      return waiting || pickDueSubjects(store.subjects.list(), at, left).length > 0;
    },
    dailyCleanup: (at) => runDailyCleanup(store, at),
    ...messagesFor(config, store, deps, now, db),
    memory,
    record: recorder(store, deps.log, now),
    every: deps.every,
    stop: deps.stop,
  });
}

/**
 * Reads the details of what the feeds listed, under the YouTube lease: the
 * feeds themselves cost nothing, but this step spends units like any other
 * read. When other work holds the lease the ids are left for the next round;
 * they are still in the feed then.
 */
const feedDetails =
  (cycle: Parameters<typeof detailChannelFinds>[0], lease: LeaseDeps) =>
  async (ids: readonly string[], signal?: AbortSignal): Promise<FindsReport> => {
    const source = { kind: 'channel_feed', confirmed: true } as const;
    try {
      return await withYouTubeLease(lease, (lost) =>
        detailChannelFinds(
          cycle,
          ids,
          source,
          signal === undefined ? lost : AbortSignal.any([lost, signal]),
        ),
      );
    } catch (error) {
      if (!(error instanceof ReadingElsewhereError)) throw error;
      return { ...NO_FINDS, stopped: 'lease_lost' };
    }
  };

/**
 * Opens the store (copying it first if it needs bringing up to date), builds
 * the cycles and starts the loop. Throws when the store cannot be opened.
 */
export function startService(config: Config, deps: ServiceDeps): Service {
  const now = deps.now ?? ((): Date => new Date());
  const db = openDatabase(config.dbPath, now());
  try {
    const scheduler = schedulerOver(config, deps, now, db);
    return {
      async stop() {
        await scheduler.stop();
        db.close();
      },
      whenIdle: () => scheduler.whenIdle(),
    };
  } catch (error) {
    db.close();
    throw error;
  }
}
