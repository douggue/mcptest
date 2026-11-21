/**
 * Alerts for one centre channel: its rule, what the rule has found, and the
 * unread count for each saved channel. A read first checks any rule a
 * refresh has made due, so a refresh from the command line is caught up on.
 */
import {
  ALERT_MAX_MIN_SCORE,
  ALERT_MIN_MIN_SCORE,
  DEFAULT_ALERT_MIN_SCORE,
  checkDueAlerts,
  type AlertCheckDeps,
  type AlertRule,
  type StoredAlert,
} from '@jgtube/core';
import type { AlertRuleView, AlertsEngine, AlertsReply, AlertView } from './alertsTypes';

/** The newest alerts shown for a channel; older ones stay in the store. */
export const ALERTS_SHOWN = 30;

export interface AlertsEngineDeps {
  readonly now: () => Date;
  readonly repos: AlertCheckDeps;
}

const ruleView = (rule: AlertRule): AlertRuleView => ({
  minScore: rule.minScore,
  takenOff: rule.takenOff,
  enabled: rule.enabled,
  createdAt: rule.createdAt.toISOString(),
  checkedAt: rule.checkedAt.toISOString(),
});

const alertView = ({
  centerChannelId: _center,
  readAt,
  foundAt,
  ...alert
}: StoredAlert): AlertView => ({
  ...alert,
  foundAt: foundAt.toISOString(),
  read: readAt !== null,
});

export function alertsEngine({ now, repos }: AlertsEngineDeps): AlertsEngine {
  const hasMap = (center: string): boolean => repos.maps.latestForCenter(center) !== null;

  const reply = (center: string): AlertsReply => {
    const rule = repos.alerts.rule(center);
    return {
      centerChannelId: center,
      rule: rule && ruleView(rule),
      defaultMinScore: DEFAULT_ALERT_MIN_SCORE,
      minMinScore: ALERT_MIN_MIN_SCORE,
      maxMinScore: ALERT_MAX_MIN_SCORE,
      alerts: repos.alerts.list(center, ALERTS_SHOWN).map(alertView),
      unread: repos.alerts.unreadCounts().get(center) ?? 0,
      lastRefreshAt: repos.runs.latest()?.finishedAt.toISOString() ?? null,
    };
  };

  return {
    findAlerts(center) {
      if (!hasMap(center)) return null;
      checkDueAlerts(repos, now());
      return reply(center);
    },

    alertCounts() {
      checkDueAlerts(repos, now());
      return Object.fromEntries(repos.alerts.unreadCounts());
    },

    saveAlertRule(center, settings) {
      if (!hasMap(center)) return null;
      repos.alerts.saveRule(center, settings, now());
      return reply(center);
    },

    markAlertsRead(center) {
      if (!hasMap(center)) return null;
      repos.alerts.markRead(center, now());
      return reply(center);
    },
  };
}
