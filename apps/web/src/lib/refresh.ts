import type { RefreshProgress } from '@jgtube/core';
import type { RefreshReply, RefreshSummary } from './api';
import { formatAge } from './format';

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
/** Up to this long ago a time is given in hours; "1 day ago" would hide half a day. */
const HOURS_SHOWN_UNTIL_MS = 2 * DAY_MS;

const count = (value: number, unit: string): string => `${value} ${unit}${value === 1 ? '' : 's'}`;

/** How long ago something happened, in the unit that reads naturally. */
function ago(since: number): string {
  if (since < MINUTE_MS) return 'just now';
  if (since < HOUR_MS) return `${count(Math.floor(since / MINUTE_MS), 'minute')} ago`;
  if (since < HOURS_SHOWN_UNTIL_MS) return `${count(Math.floor(since / HOUR_MS), 'hour')} ago`;
  return `${formatAge(since / DAY_MS)} ago`;
}

function describeDue(state: RefreshReply): string {
  if (state.due === 0) return 'Every stored channel has been read in the last day.';
  const channels = state.channels === 1 ? 'channel is' : 'channels are';
  return `${state.due} of ${state.channels} ${channels} due.`;
}

/** In words, when the stored channels were last read again and how much is due. */
export function describeRefresh(state: RefreshReply, now: Date): string {
  const { last } = state;
  if (last === null) {
    const have = state.channels === 1 ? 'has' : 'have';
    return `The ${count(state.channels, 'stored channel')} ${have} not been read again yet. Reading them again a day apart shows what each one really gained.`;
  }
  const when = ago(Math.max(0, now.getTime() - new Date(last.finishedAt).getTime()));
  const unread = last.failed > 0 ? `, ${last.failed} could not be read` : '';
  const stopped = last.stoppedEarly
    ? '; it stopped early because YouTube was refusing requests'
    : '';
  return `Last refresh ${when}: ${count(last.refreshed, 'channel')} read again${unread}${stopped}. ${describeDue(state)}`;
}

/** Whether a timer refreshes the store, and how to set one when it does not. */
export function describeSchedule(everyHours: number | null): string {
  if (everyHours === null) {
    return 'To refresh by itself, set Refresh every (hours) in Settings, for example to 6, and restart Jgtube.';
  }
  const every = everyHours === 1 ? 'every hour' : `every ${everyHours} hours`;
  return `Refreshes by itself ${every} while Jgtube is running.`;
}

/** What a refresh under way is doing. */
export function describeProgress(progress: RefreshProgress | null): string {
  return progress
    ? `Reading channels again: ${progress.done} of ${progress.total}`
    : 'Choosing the channels read longest ago';
}

/** How reading the account dates went, as a sentence to append; empty when there is nothing to say. */
function describeFacts(summary: RefreshSummary): string {
  if (summary.factsProblem) return ` Account dates could not be read: ${summary.factsProblem}`;
  return summary.factsAdded > 0
    ? ` Account dates read for ${count(summary.factsAdded, 'channel')}.`
    : '';
}

/** What reading the channels again did, in a sentence. */
function describeReads(summary: RefreshSummary): string {
  if (summary.refreshed === 0 && summary.failed === 0) {
    return 'Nothing was due: every stored channel has been read in the last day.';
  }
  const unread = summary.failed > 0 ? `; ${summary.failed} could not be read` : '';
  const stopped = summary.stoppedEarly
    ? ` Stopped early because YouTube was refusing requests; ${summary.notAttempted} were not tried.`
    : '';
  return `Read ${count(summary.refreshed, 'channel')} again${unread}.${stopped}`;
}

/** What a finished refresh did, in a sentence or two. */
export function describeOutcome(summary: RefreshSummary): string {
  return `${describeReads(summary)}${describeFacts(summary)}`;
}
