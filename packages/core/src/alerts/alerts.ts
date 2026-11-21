import { hadReadingBy, videosAsOf } from '../changes/asOf';
import type { ChannelHistory } from '../changes/changes';
import { DEFAULT_BREAKOUT_WINDOW_DAYS, DEFAULT_MIN_BREAKOUT_SCORE } from '../map/breakouts';
import { channelMetrics } from '../map/view';
import { buildVideoReport, type VideoReportRow } from '../report';

/**
 * Alerts for one centre channel: worked out in code from stored readings
 * after a refresh, never sent anywhere. A look-alike's video is told of when
 * its outlier score has passed the owner's number since the last check, and
 * a look-alike when it newly counts as taken off. Both states are judged by
 * the page's own rules, the earlier one on the store as it was then.
 */

/**
 * The owner's number when none is chosen: five times the channel's usual
 * views, well past the page's breakout bar (2×), so an alert is rarer than a
 * breakout. Shown beside the field; the owner changes it per channel.
 */
export const DEFAULT_ALERT_MIN_SCORE = 5;
/** Below the breakout bar a video is not a breakout at all. */
export const ALERT_MIN_MIN_SCORE = DEFAULT_MIN_BREAKOUT_SCORE;
/** Past this the field is more likely a slip than a wish. */
export const ALERT_MAX_MIN_SCORE = 100;

export const isValidMinScore = (value: number): boolean =>
  Number.isFinite(value) && value >= ALERT_MIN_MIN_SCORE && value <= ALERT_MAX_MIN_SCORE;

export type AlertKind = 'breakout' | 'taken-off';

/** What a rule asks to be told of. */
export interface AlertCriteria {
  /** A video's outlier score at or past which it is told of. */
  readonly minScore: number;
  /** Whether a look-alike that newly takes off is told of. */
  readonly takenOff: boolean;
}

export interface AlertFinding {
  readonly kind: AlertKind;
  /** The video id of a breakout, the channel id of a channel that took off. */
  readonly subjectId: string;
  readonly channelId: string;
  readonly channelTitle: string;
  /** A breakout's title, score and views when found; null for a channel. */
  readonly videoTitle: string | null;
  readonly score: number | null;
  readonly views: number | null;
}

export interface AlertInput {
  readonly lookalikes: readonly ChannelHistory[];
  readonly since: Date;
  readonly now: Date;
  readonly rule: AlertCriteria;
}

const passes = (row: VideoReportRow | undefined, minScore: number): boolean =>
  row !== undefined &&
  row.score !== null &&
  row.score >= minScore &&
  row.ageDays <= DEFAULT_BREAKOUT_WINDOW_DAYS;

function channelAlerts(history: ChannelHistory, input: AlertInput): readonly AlertFinding[] {
  const { channel, videos, readings } = history;
  const { since, now, rule } = input;
  const earlier = videosAsOf(videos, readings, since);
  const then = new Map(buildVideoReport(earlier, since).map((row) => [row.id, row]));
  const base = { channelId: channel.id, channelTitle: channel.title };
  const breakouts = buildVideoReport(videos, now)
    .filter((row) => passes(row, rule.minScore) && !passes(then.get(row.id), rule.minScore))
    .map((row): AlertFinding => ({
      ...base,
      kind: 'breakout',
      subjectId: row.id,
      videoTitle: row.title,
      score: row.score,
      views: row.views,
    }));
  const tookOff =
    rule.takenOff &&
    channelMetrics(videos, channel.subscribers, now).group === 'taken-off' &&
    channelMetrics(earlier, channel.subscribers, since).group !== 'taken-off';
  const takenOff: readonly AlertFinding[] = tookOff
    ? [
        {
          ...base,
          kind: 'taken-off',
          subjectId: channel.id,
          videoTitle: null,
          score: null,
          views: null,
        },
      ]
    : [];
  return [...takenOff, ...breakouts];
}

/**
 * What a rule tells of between `since` and `now`. A look-alike with no
 * reading by `since` cannot be compared, so nothing of it is told.
 */
export function findAlerts(input: AlertInput): readonly AlertFinding[] {
  return input.lookalikes
    .filter((history) => hadReadingBy(history.readings, input.since))
    .flatMap((history) => channelAlerts(history, input));
}
