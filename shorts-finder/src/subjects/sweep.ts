/**
 * The two searches made for each subject, and how the second paces itself.
 *
 * "Top recent" asks for the most-viewed videos of the last two days: over so
 * short a time, total views roughly follow views per hour, so it surfaces
 * what is moving. "Newest" asks for everything published since its last
 * sweep, newest first: it is how a video is met in its first hours, before
 * it has the views to rank anywhere.
 *
 * Nothing here is a number about any subject. How often a subject's newest
 * sweep runs is measured on that subject alone, from how full its own sweeps
 * come back.
 */
import type { SearchKind, Subject } from '../repos/types';

const MS_PER_HOUR = 60 * 60 * 1000;
/**
 * A top-recent search looks back 48 hours. Short enough that total views
 * still follow speed (a week lets one early burst outrank everything since),
 * long enough that a subject searched once a day sees each video twice.
 */
export const TOP_RECENT_WINDOW_HOURS = 48;
/**
 * A first newest sweep, or one long overdue, looks back 48 hours at most:
 * the same reach as the top-recent search. Further back than that a video's
 * first hours are gone, which are what this sweep exists to catch, and the
 * top-recent search is the net for what mattered among the older ones.
 */
export const NEWEST_MAX_LOOKBACK_HOURS = 48;
/** What the API returns at most for one search: a sweep with this many may have missed some. */
export const FULL_PAGE = 50;
/**
 * A subject's newest sweep never runs more often than every three hours,
 * however full it comes back: eight searches a day for one subject is already
 * more than a seventh of the default search share, and below that one busy
 * subject would starve the rest. A starting value, to be revisited on evidence.
 */
export const NEWEST_MIN_INTERVAL_HOURS = 3;

/** The search order the API is asked for. */
export const ORDER_OF: Readonly<Record<SearchKind, 'viewCount' | 'date'>> = {
  top_recent: 'viewCount',
  newest: 'date',
};

const hoursBefore = (now: Date, hours: number): Date =>
  new Date(now.getTime() - hours * MS_PER_HOUR);

/** The moment a search of this kind asks for videos published after. */
export function publishedAfterFor(subject: Subject, kind: SearchKind, now: Date): Date {
  if (kind === 'top_recent') return hoursBefore(now, TOP_RECENT_WINDOW_HOURS);
  const earliest = hoursBefore(now, NEWEST_MAX_LOOKBACK_HOURS);
  const sweptTo = subject.newestSweptTo;
  // A sweep that ended "after now" (the clock was set back) is no use as a start.
  if (sweptTo === null || sweptTo < earliest || sweptTo > now) return earliest;
  return sweptTo;
}

/**
 * The interval a newest sweep leaves its subject on, from how many results it
 * returned. A full page means videos were probably missed behind it, so the
 * interval halves, down to the floor. A page under half full means the pace
 * is more than enough, so it doubles back towards the configured cadence. In
 * between it stays as it is.
 */
export function nextNewestInterval(
  currentHours: number,
  configuredHours: number,
  results: number,
): number {
  const floor = Math.min(NEWEST_MIN_INTERVAL_HOURS, configuredHours);
  if (results >= FULL_PAGE) return Math.max(floor, currentHours / 2);
  if (results < FULL_PAGE / 2) return Math.min(configuredHours, currentHours * 2);
  return Math.min(configuredHours, Math.max(floor, currentHours));
}
