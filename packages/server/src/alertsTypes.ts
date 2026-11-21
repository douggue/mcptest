/**
 * Alerts as the API sees them: one rule per centre channel and the alerts it
 * has found, worked out on this computer from stored readings.
 */
import type { AlertKind, AlertSettings } from '@jgtube/core';

export interface AlertRuleView {
  readonly minScore: number;
  readonly takenOff: boolean;
  readonly enabled: boolean;
  /** ISO-8601. */
  readonly createdAt: string;
  readonly checkedAt: string;
}

export interface AlertView {
  readonly id: number;
  readonly kind: AlertKind;
  readonly subjectId: string;
  readonly channelId: string;
  readonly channelTitle: string;
  readonly videoTitle: string | null;
  readonly score: number | null;
  readonly views: number | null;
  readonly foundAt: string;
  readonly read: boolean;
}

export interface AlertsReply {
  readonly centerChannelId: string;
  /** Null until the owner sets one. */
  readonly rule: AlertRuleView | null;
  readonly defaultMinScore: number;
  readonly minMinScore: number;
  readonly maxMinScore: number;
  /** The newest first, up to a stated number. */
  readonly alerts: readonly AlertView[];
  readonly unread: number;
  /** When the last refresh finished: alerts are only as fresh as that. */
  readonly lastRefreshAt: string | null;
}

export interface AlertsEngine {
  /** A channel's rule and alerts, after checking any rule a refresh has made due; null with no map. */
  findAlerts(centerChannelId: string): AlertsReply | null;
  /** Unread alerts per centre channel, after the same check; channels with none left out. */
  alertCounts(): Readonly<Record<string, number>>;
  saveAlertRule(centerChannelId: string, settings: AlertSettings): AlertsReply | null;
  markAlertsRead(centerChannelId: string): AlertsReply | null;
}
