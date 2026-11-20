/**
 * The two messages that go out once a day, from a set hour of the owner's
 * day: the summary (the day's counts and the best of what the alert limit
 * left out) and the line that says the service is still running, so a day
 * with neither means something is wrong.
 *
 * Which day each last went out for is kept in the store, so a restart does
 * not send them again, and a service that was down at the hour sends them
 * when it comes back the same day.
 */
import type { QuotaKind } from '../quota/kinds';
import { alertsPaused, pauseAfter, type AlertDeps, type NotSent } from './alertCycle';
import { formatDigest, formatHeartbeat, type LastProblem } from './format';
import { endOfLocalDay, localMoment, startOfLocalDay } from './localTime';
import type { SendResult } from './telegram';

export const DIGEST_SENT_FOR_DAY = 'alerts.digestDay';
export const HEARTBEAT_SENT_FOR_DAY = 'alerts.heartbeatDay';
/** The most left-over findings one summary takes; far more than a day should ever hold. */
const MAX_LEFT_OVER = 500;

/** What the service can say about itself, for the summary and the still-running line. */
export interface ServiceStats {
  readonly unitsSpent: number;
  readonly dailyUnits: number;
  readonly unitsByKind: Readonly<Record<QuotaKind, number>>;
  readonly searchesToday: number;
  readonly tracked: number;
  readonly dueUnread: number;
  /** Null for a store in memory. */
  readonly storeBytes: number | null;
  readonly lastProblem: LastProblem | null;
}

export interface DailyDeps extends AlertDeps {
  readonly stats: (now: Date) => ServiceStats;
}

/** `sent`, why it was not, or `not_due` when it had gone out already (or was not reached). */
export type DailyOutcome = 'sent' | 'not_due' | NotSent;

export interface DailyReport {
  readonly digest: DailyOutcome;
  readonly heartbeat: DailyOutcome;
  /** Findings the summary told of in place of alerts of their own. */
  readonly digested: number;
  readonly failure: string | null;
}

async function sendDigest(deps: DailyDeps, day: string, stats: ServiceStats): Promise<SendResult> {
  const now = deps.now();
  const { maxPerDay, timeZone } = deps.settings;
  const from = startOfLocalDay(now, timeZone);
  const to = endOfLocalDay(now, timeZone);
  const alerted = deps.findings.countAlertedBetween(from, to);
  // Below the limit, what waits will still get an alert of its own.
  const leftOver = alerted >= maxPerDay ? deps.findings.listWaiting(MAX_LEFT_OVER) : [];
  const html = formatDigest({
    day,
    found: deps.findings.listFoundBetween(from, to).length,
    alerted,
    leftOver,
    unitsSpent: stats.unitsSpent,
    dailyUnits: stats.dailyUnits,
  });
  const result = await deps.send(html);
  if (result.kind === 'sent') {
    deps.findings.markDigested(
      leftOver.map((finding) => finding.id),
      deps.now(),
    );
    deps.state.set(DIGEST_SENT_FOR_DAY, day, deps.now());
  }
  return result;
}

async function sendHeartbeat(
  deps: DailyDeps,
  day: string,
  stats: ServiceStats,
): Promise<SendResult> {
  const result = await deps.send(formatHeartbeat({ ...stats, now: deps.now() }));
  if (result.kind === 'sent') deps.state.set(HEARTBEAT_SENT_FOR_DAY, day, deps.now());
  return result;
}

/**
 * Sends whichever of the day's two messages is due and has not gone out.
 * Returns null when nothing was tried: before the hour, both sent already, or
 * a pause is on. A message that is not accepted is tried again later.
 */
export async function runDailyMessages(deps: DailyDeps): Promise<DailyReport | null> {
  const now = deps.now();
  const local = localMoment(now, deps.settings.timeZone);
  if (local.hour < deps.settings.digestHour || alertsPaused(deps)) return null;
  const digestDue = deps.state.get(DIGEST_SENT_FOR_DAY) !== local.day;
  const heartbeatDue = deps.state.get(HEARTBEAT_SENT_FOR_DAY) !== local.day;
  if (!digestDue && !heartbeatDue) return null;
  const stats = deps.stats(now);
  const waitingBefore = deps.findings.countWaiting();
  let report: DailyReport = {
    digest: 'not_due',
    heartbeat: 'not_due',
    digested: 0,
    failure: null,
  };
  if (digestDue) {
    const result = await sendDigest(deps, local.day, stats);
    report = { ...report, digest: result.kind };
    if (result.kind !== 'sent') return { ...report, failure: pauseAfter(deps, result) };
    report = { ...report, digested: waitingBefore - deps.findings.countWaiting() };
  }
  if (heartbeatDue) {
    const result = await sendHeartbeat(deps, local.day, stats);
    report = { ...report, heartbeat: result.kind };
    if (result.kind !== 'sent') return { ...report, failure: pauseAfter(deps, result) };
  }
  return report;
}
