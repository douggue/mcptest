import type { AlertKind } from '@jgtube/core';
import { since, span } from './changes';
import { formatCount, formatScore } from './format';

/** A centre channel's alert rule, as the server answers it. Times are ISO-8601. */
export interface AlertRuleView {
  readonly minScore: number;
  readonly takenOff: boolean;
  readonly enabled: boolean;
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
  readonly rule: AlertRuleView | null;
  readonly defaultMinScore: number;
  readonly minMinScore: number;
  readonly maxMinScore: number;
  readonly alerts: readonly AlertView[];
  readonly unread: number;
  readonly lastRefreshAt: string | null;
}

/** What the owner sets. */
export interface AlertSettingsInput {
  readonly minScore: number;
  readonly takenOff: boolean;
  readonly enabled: boolean;
}

/** The owner's number as written: "6×", "6.5×". */
const numberLabel = (value: number): string =>
  `${Number.isInteger(value) ? value : value.toFixed(1)}×`;

const videoPart = (minScore: number): string =>
  `a look-alike video at ${numberLabel(minScore)} its channel’s usual views or more`;

/** One alert in a sentence; the score is said against the channel's usual views. */
export function alertLine(alert: AlertView): string {
  if (alert.kind === 'taken-off')
    return `${alert.channelTitle} now counts as taken off on this map.`;
  const score =
    alert.score === null ? '' : ` ${formatScore(alert.score)} its channel's usual views,`;
  return `${alert.channelTitle}:${score} ${formatCount(alert.views)} views so far.`;
}

/** What the rule tells of, or that there is none or it is off. */
export function ruleSummary(rule: AlertRuleView | null, defaultMinScore: number): string {
  if (rule === null) {
    return `No alert rule yet. The suggested number is ${numberLabel(defaultMinScore)}: ${videoPart(defaultMinScore)}.`;
  }
  if (!rule.enabled) return 'Alerts are off for this channel.';
  const takenOff = rule.takenOff ? ', and of a look-alike that newly takes off' : '';
  return `Telling you of ${videoPart(rule.minScore)}${takenOff}.`;
}

export type Parsed =
  { readonly ok: true; readonly value: number } | { readonly ok: false; readonly message: string };

/** The owner's number from the field, within the stated range. */
export function parseMinScore(text: string, min: number, max: number): Parsed {
  const trimmed = text.trim();
  const value = Number(trimmed);
  return trimmed !== '' && Number.isFinite(value) && value >= min && value <= max
    ? { ok: true, value }
    : { ok: false, message: `Give a number from ${min} to ${max}.` };
}

/** That alerts are worked out here after each refresh, and how fresh that is. */
export function freshnessNote(lastRefreshAt: string | null, now: Date): string {
  if (lastRefreshAt === null) {
    return 'No refresh has run yet, so no alert can be found. Alerts are checked on this computer after each refresh; nothing is sent anywhere.';
  }
  return `Alerts are checked on this computer after each refresh, so they are only as fresh as the last one, which finished ${span(since(lastRefreshAt, now))} ago. Nothing is sent anywhere.`;
}

/** Most unread alerts a chip's badge counts; past it the badge says "9+". */
const BADGE_MAX = 9;

/** The text of a chip's badge; null when there is nothing unread. */
export function badgeText(unread: number): string | null {
  if (unread <= 0) return null;
  return unread > BADGE_MAX ? `${BADGE_MAX}+` : String(unread);
}
