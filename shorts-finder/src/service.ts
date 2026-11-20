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
import { readQueuedChannels } from './discover/channelReads';
import { runSearchCycle } from './discover/searchCycle';
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
import { runReadCycle } from './track/readCycle';
import { rollUpOldReadings } from './track/rollup';
import { createYouTubeApi } from './youtube/api';

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
  const cycle = { api, ledger, store, now };
  const memory: SchedulerMemory = {
    get: (key) => store.state.get(key),
    set: (key, value) => store.state.set(key, value, now()),
  };
  return startScheduler({
    lease: { leases: new SqliteLeaseRepo(db), now },
    now,
    readCycle: (signal) => runReadCycle(cycle, signal),
    channelReads: (signal) => readQueuedChannels(cycle, signal),
    searchCycle: (signal) => runSearchCycle(cycle, signal),
    searchIsDue: (at) => {
      const left = ledger.remaining(at).byKind.search;
      // Results still waiting for their details are work for a round as well.
      const waiting = store.pending.count() > 0 && left >= DETAILS_COST_UNITS;
      return waiting || pickDueSubjects(store.subjects.list(), at, left).length > 0;
    },
    dailyRollup: (at) => rollUpOldReadings(store.readings, at),
    ...messagesFor(config, store, deps, now, db),
    memory,
    record: recorder(store, deps.log, now),
    every: deps.every,
    stop: deps.stop,
  });
}

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
