import type { Db } from '../db/sqlite';
import { SqliteAlertRepo } from '../repos/sqliteAlertRepo';
import { SqliteRefreshRepo } from '../repos/sqliteRefreshRepo';
import { lookalikeHistories, type HistoryDeps } from '../changes/load';
import type { RefreshRunRepo } from '../repos/types';
import { findAlerts } from './alerts';
import type { AlertRepo, AlertRule } from './store';

export type AlertCheckDeps = HistoryDeps & {
  readonly alerts: AlertRepo;
  readonly runs: Pick<RefreshRunRepo, 'latest'>;
};

export interface AlertCheck {
  /** Rules compared, and alerts that were new. */
  readonly checked: number;
  readonly added: number;
}

/** One rule from its last check up to now; returns how many alerts were new. */
function checkRule(deps: AlertCheckDeps, rule: AlertRule, now: Date): number {
  const found = lookalikeHistories(deps, rule.centerChannelId, now);
  const findings = found
    ? findAlerts({ lookalikes: found.histories, since: rule.checkedAt, now, rule })
    : [];
  const added = deps.alerts.add(rule.centerChannelId, findings, now);
  deps.alerts.markChecked(rule.centerChannelId, now);
  return added;
}

/**
 * Checks every rule that is on and has a refresh finished after its last
 * check: alerts can only be as fresh as the stored readings. Run after each
 * refresh, and before alerts are read so a refresh from the command line is
 * caught up on. Reads the store only; nothing leaves the computer.
 */
export function checkDueAlerts(deps: AlertCheckDeps, now: Date): AlertCheck {
  const lastRefresh = deps.runs.latest()?.finishedAt.getTime() ?? null;
  if (lastRefresh === null) return { checked: 0, added: 0 };
  const due = deps.alerts
    .listRules()
    .filter((rule) => rule.enabled && rule.checkedAt.getTime() < lastRefresh);
  const added = due.reduce((total, rule) => total + checkRule(deps, rule, now), 0);
  return { checked: due.length, added };
}

/** `checkDueAlerts` on an open store, for a refresh to call in one line. */
export function checkStoredAlerts(db: Db, repos: HistoryDeps, now: Date): AlertCheck {
  return checkDueAlerts(
    { ...repos, alerts: new SqliteAlertRepo(db), runs: new SqliteRefreshRepo(db) },
    now,
  );
}
