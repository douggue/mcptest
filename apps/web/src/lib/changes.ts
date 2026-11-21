import type {
  ChangesFreshness,
  ChangesView,
  GroupChange,
  LookalikeChanges,
  MapChanges,
  NewBreakout,
  SinceKind,
} from '@jgtube/core';
import { formatAge, formatCount, formatScore } from './format';

/** What changed around a channel, as the server answers it. */
export interface ChangesReply extends ChangesView {
  readonly asked: SinceKind;
  /** The moment answered for: a week when "last look" was asked and none is stored. */
  readonly sinceKind: SinceKind;
  readonly lastLookAt: string | null;
}

export const SINCE_OPTIONS: readonly { readonly id: SinceKind; readonly label: string }[] = [
  { id: 'last-look', label: 'Since your last look' },
  { id: 'yesterday', label: 'Since yesterday' },
  { id: 'week', label: 'Since 7 days' },
];

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
/** Up to this long a time is given in hours; "1 day" would hide half a day. */
const HOURS_SHOWN_UNTIL_MS = 2 * DAY_MS;
/** A look-alike read longer ago than this is due for a refresh: the refresh's own rule, in hours. */
const STALE_AFTER_HOURS = 24;

const count = (value: number, unit: string): string => `${value} ${unit}${value === 1 ? '' : 's'}`;

/** A length of time in the unit that reads naturally. */
function span(ms: number): string {
  if (ms < HOUR_MS) return count(Math.max(1, Math.floor(ms / MINUTE_MS)), 'minute');
  if (ms < HOURS_SHOWN_UNTIL_MS) return count(Math.floor(ms / HOUR_MS), 'hour');
  return formatAge(ms / DAY_MS);
}

const since = (iso: string, now: Date): number =>
  Math.max(0, now.getTime() - new Date(iso).getTime());

/** The moment the comparison starts from, in a sentence. */
export function describeSince(reply: ChangesReply, now: Date): string {
  if (reply.sinceKind === 'yesterday') return 'Since this time yesterday.';
  if (reply.sinceKind === 'last-look' && reply.lastLookAt !== null) {
    return `Since you last marked this as seen, ${span(since(reply.lastLookAt, now))} ago.`;
  }
  return reply.asked === 'last-look'
    ? 'You have not marked this channel as seen yet, so this covers the last 7 days.'
    : 'Over the last 7 days.';
}

/** Whether nothing of any kind changed, so the section can say so in one line. */
export function hasNothingNew(reply: ChangesReply): boolean {
  const { changes, lookalikes } = reply;
  const { takenOff, rising, droppedOut } = changes.groups;
  const moved = lookalikes.comparable ? lookalikes.added.length + lookalikes.gone.length : 0;
  return (
    changes.newBreakoutCount === 0 &&
    takenOff.length + rising.length + droppedOut.length === 0 &&
    changes.formats.length === 0 &&
    moved === 0
  );
}

/** What a new breakout was at the earlier moment. */
export function breakoutBefore(entry: NewBreakout): string {
  if (entry.was === 'not-stored' || entry.viewsThen === null) {
    return 'Not stored then: published or first read since.';
  }
  const views = `${formatCount(entry.viewsThen)} views then`;
  return entry.scoreThen === null
    ? `Had ${views}, too few videos to score.`
    : `Was ${formatScore(entry.scoreThen)} with ${views}.`;
}

/** How many new breakouts are not shown; null when all are. */
export function moreBreakouts(changes: MapChanges): string | null {
  const hidden = changes.newBreakoutCount - changes.newBreakouts.length;
  return hidden > 0 ? `And ${hidden} more, lower down the breakout list below.` : null;
}

const WAS: Readonly<Record<GroupChange['was'], string>> = {
  'taken-off': 'had taken off',
  rising: 'was rising',
  neither: 'was neither',
};
const NOW: Readonly<Record<GroupChange['now'], string>> = {
  'taken-off': 'has now taken off',
  rising: 'is now rising',
  neither: 'is now neither',
};

/** One channel's move from one group to another. */
export function groupLine(change: GroupChange): string {
  return `${change.title}: ${WAS[change.was]}, ${NOW[change.now]}`;
}

/** Why there is no list of look-alikes that came or went; null when there is one to show. */
export function describeLookalikes(lookalikes: LookalikeChanges): string | null {
  if (lookalikes.comparable) {
    return lookalikes.added.length + lookalikes.gone.length === 0
      ? 'The map was made again and its look-alikes are the same.'
      : null;
  }
  if (lookalikes.reason === 'same-map') {
    return 'The map has not been made again since then, so the look-alikes are the same.';
  }
  return lookalikes.reason === 'no-earlier-map'
    ? 'This channel had no map yet at that time, so there is no earlier list of look-alikes to compare with.'
    : 'The earlier map was stored under older matching rules, so its look-alikes cannot be compared.';
}

/** A plain note when some look-alikes had no reading to compare with; null when all had. */
export function uncomparedNote(changes: MapChanges): string | null {
  const { comparedChannels, uncomparedChannels } = changes;
  if (uncomparedChannels === 0) return null;
  if (comparedChannels === 0) {
    return `None of the ${count(uncomparedChannels, 'look-alike')} had been read before that time, so there is nothing to compare with yet. Refresh, and look again tomorrow.`;
  }
  const had = uncomparedChannels === 1 ? 'look-alike had' : 'look-alikes had';
  return `${uncomparedChannels} ${had} not been read before that time, so nothing of theirs can be called new yet.`;
}

/** When the look-alikes were last read, and whether any is due for a refresh. */
export function describeFreshness(
  freshness: ChangesFreshness,
  now: Date,
): { readonly text: string; readonly stale: boolean } {
  const { channels, oldestReadAt, newestReadAt, lastRefreshAt } = freshness;
  if (channels === 0 || oldestReadAt === null || newestReadAt === null) {
    return {
      text: 'This map has no look-alikes yet, so there is nothing to compare.',
      stale: false,
    };
  }
  const oldest = since(oldestReadAt, now);
  const newest = since(newestReadAt, now);
  const read =
    span(oldest) === span(newest)
      ? `${span(newest)} ago`
      : `between ${span(oldest)} and ${span(newest)} ago`;
  const refresh =
    lastRefreshAt === null
      ? 'no refresh has run yet'
      : `the last refresh finished ${span(since(lastRefreshAt, now))} ago`;
  return {
    text: `The ${count(channels, 'look-alike')} were last read ${read}; ${refresh}.`,
    stale: oldest > STALE_AFTER_HOURS * HOUR_MS,
  };
}
