/**
 * Tells the owner of what was found: one message for each finding, oldest
 * first, up to a number a day. Too many alerts are soon ignored, so what the
 * daily limit leaves out goes into the day's summary instead (see
 * `dailyMessages.ts`).
 *
 * A finding is marked as told only after Telegram has accepted its message,
 * and the cycle stops at the first message that is not accepted, leaving the
 * rest for the next cycle. Telegram offers no way to send "only once": if the
 * program dies between Telegram accepting a message and the mark being
 * written, that one finding is sent again after the restart.
 */
import type { FindingRepo, ServiceStateRepo } from '../repos/types';
import type { RateRange } from '../scoring/earnings';
import { formatFinding } from './format';
import { endOfLocalDay, startOfLocalDay } from './localTime';
import type { Send, SendResult } from './telegram';

export const DEFAULT_MAX_ALERTS_PER_DAY = 10;
const MS_PER_SECOND = 1000;
/**
 * After a message fails for any reason but "too fast", nothing is sent for a
 * quarter of an hour: a wrong token or a network fault is not cured by asking
 * every five minutes, and the findings wait in the store meanwhile.
 */
export const ALERT_FAILURE_PAUSE_MS = 15 * 60 * MS_PER_SECOND;
/** Where the end of a pause is remembered, so a restart keeps to it. */
export const ALERTS_PAUSED_UNTIL = 'alerts.pausedUntil';

export interface AlertSettings {
  /** The most findings told of one by one in a day of the owner's. */
  readonly maxPerDay: number;
  /** The hour of the owner's day from which the summary and the still-running line go out. */
  readonly digestHour: number;
  /** The owner's time zone, such as Europe/London. */
  readonly timeZone: string;
  readonly rate: RateRange;
}

export interface AlertDeps {
  readonly findings: FindingRepo;
  readonly state: ServiceStateRepo;
  readonly send: Send;
  readonly now: () => Date;
  readonly settings: AlertSettings;
}

/** Why a message was not accepted. */
export type NotSent = Exclude<SendResult['kind'], 'sent'>;

export interface AlertCycleReport {
  /** Findings told of in this cycle. */
  readonly sent: number;
  /** Findings still waiting after it. */
  readonly waiting: number;
  /** Why the cycle stopped before the day's limit or the end of the list; null when it did not. */
  readonly stopped: NotSent | null;
  /** What went wrong, when the stop was a fault rather than Telegram asking for a pause. */
  readonly failure: string | null;
}

/** Whether a pause, asked for by Telegram or after a failure, is still on. */
export function alertsPaused(deps: Pick<AlertDeps, 'state' | 'now'>): boolean {
  const until = deps.state.get(ALERTS_PAUSED_UNTIL);
  if (until === null) return false;
  const end = new Date(until).getTime();
  return Number.isFinite(end) && deps.now().getTime() < end;
}

/** Starts the pause a message that was not accepted calls for, and says what went wrong. */
export function pauseAfter(
  deps: Pick<AlertDeps, 'state' | 'now'>,
  result: Exclude<SendResult, { kind: 'sent' }>,
): string | null {
  const now = deps.now();
  const pause =
    result.kind === 'retry_after' ? result.seconds * MS_PER_SECOND : ALERT_FAILURE_PAUSE_MS;
  deps.state.set(ALERTS_PAUSED_UNTIL, new Date(now.getTime() + pause).toISOString(), now);
  return result.kind === 'retry_after' ? null : result.message;
}

/** How many more alerts today's limit allows. */
function roomToday(deps: AlertDeps): number {
  const now = deps.now();
  const { maxPerDay, timeZone } = deps.settings;
  const sentToday = deps.findings.countAlertedBetween(
    startOfLocalDay(now, timeZone),
    endOfLocalDay(now, timeZone),
  );
  return Math.max(0, maxPerDay - sentToday);
}

/**
 * Sends the waiting findings, oldest first, as far as today's limit goes.
 * Returns null when nothing was tried: nothing waits, today's limit is
 * reached, or a pause is on. Never throws for a message that was not accepted.
 */
export async function runAlertCycle(deps: AlertDeps): Promise<AlertCycleReport | null> {
  if (deps.findings.countWaiting() === 0 || alertsPaused(deps)) return null;
  const room = roomToday(deps);
  if (room === 0) return null;
  let sent = 0;
  let stopped: NotSent | null = null;
  let failure: string | null = null;
  for (const finding of deps.findings.listWaiting(room)) {
    const html = formatFinding(finding, { now: deps.now(), rate: deps.settings.rate });
    const result = await deps.send(html, { preview: true });
    if (result.kind !== 'sent') {
      stopped = result.kind;
      failure = pauseAfter(deps, result);
      break;
    }
    deps.findings.markAlerted(finding.id, deps.now());
    sent += 1;
  }
  return { sent, waiting: deps.findings.countWaiting(), stopped, failure };
}
