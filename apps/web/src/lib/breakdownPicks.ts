import type { ChannelChoice, ChoiceGroup } from './breakdown';
import { formatCount, formatScore } from './format';

/**
 * The channels the Breakdown view offers, and the few it suggests first.
 * Everything here is worked out from what the server counted from stored
 * videos: no number is invented and nothing is forecast.
 */

/** What the server says of one channel, counted from the store. */
export interface CandidateFacts {
  readonly id: string;
  readonly title: string;
  readonly handle: string | null;
  readonly logoUrl: string | null;
  readonly subscribers: number | null;
  readonly storedVideos: number;
  /** Videos of the last 30 days at 2× its usual views or more. */
  readonly breakingOut: number;
  /** The best score among its videos of the last 30 days; null when none scored. */
  readonly recentBest: number | null;
  readonly top: ReadonlyArray<{
    readonly videoId: string;
    readonly title: string;
    readonly score: number | null;
  }>;
  /** ISO-8601; null when never broken down. */
  readonly brokenDownAt: string | null;
}

export type Closeness = 'close' | 'medium' | 'far';

/** One channel on offer: the facts, where it was offered from, and how close it is on the map. */
export interface Candidate extends CandidateFacts {
  readonly group: ChoiceGroup;
  /** The name as the list shows it ("Your channel: …"). */
  readonly label: string;
  /** How close a look-alike it is on the map on screen; null for a channel not on it. */
  readonly closeness: Closeness | null;
  /** The owner's own channel: never suggested. */
  readonly own: boolean;
}

/** Fewer stored videos than this, and a breakdown has too little to rest on. */
export const MIN_STORED_VIDEOS = 10;
/** A breakdown older than this may be worth doing again. */
export const STALE_DAYS = 90;
/** How many channels are suggested at the top. */
export const SUGGESTED = 3;
const DAY_MS = 86_400_000;
const CLOSENESS_WEIGHT: Readonly<Record<Closeness, number>> = { close: 3, medium: 2, far: 1 };
const CLOSENESS_WORD: Readonly<Record<Closeness, string>> = {
  close: 'Close',
  medium: 'Medium',
  far: 'Far',
};
/** The highest score counted towards a suggestion, so one freak video does not decide it. */
const SCORE_CAP = 20;

export const closenessWord = (closeness: Closeness): string => CLOSENESS_WORD[closeness];

/**
 * The channels on offer with their facts, in the order offered. A channel
 * the store does not hold (no facts) is left out: there is nothing to show
 * or break down until it is read.
 */
export function mergeCandidates(
  choices: readonly ChannelChoice[],
  facts: readonly CandidateFacts[],
  closeness: ReadonlyMap<string, Closeness>,
  ownId: string | null,
): readonly Candidate[] {
  const byId = new Map(facts.map((entry) => [entry.id, entry]));
  return choices.flatMap((choice) => {
    const found = byId.get(choice.id);
    if (!found) return [];
    return [
      {
        ...found,
        group: choice.group,
        label: choice.label,
        closeness: closeness.get(choice.id) ?? null,
        own: choice.id === ownId,
      },
    ];
  });
}

/** Days since a breakdown; null when there was none. */
const daysSince = (iso: string | null, now: Date): number | null =>
  iso === null ? null : (now.getTime() - Date.parse(iso)) / DAY_MS;

/** Whether a channel was never broken down, or so long ago it may be worth doing again. */
export const isDue = (candidate: Candidate, now: Date): boolean => {
  const days = daysSince(candidate.brokenDownAt, now);
  return days === null || days >= STALE_DAYS;
};

function weight(candidate: Candidate): number {
  const close = candidate.closeness === null ? 1 : CLOSENESS_WEIGHT[candidate.closeness];
  return close * 10 + candidate.breakingOut * 2 + Math.min(candidate.recentBest ?? 0, SCORE_CAP);
}

/** The one-line reason a channel is suggested, from its facts alone. */
export function reasonFor(candidate: Candidate, now: Date): string {
  const where =
    candidate.closeness === null
      ? 'Not on this map'
      : `${CLOSENESS_WORD[candidate.closeness]} look-alike`;
  const breaking =
    candidate.breakingOut > 0 && candidate.recentBest !== null
      ? `${candidate.breakingOut} breaking out, best ${formatScore(candidate.recentBest)} usual`
      : 'nothing breaking out this month';
  const days = daysSince(candidate.brokenDownAt, now);
  const when =
    days === null ? 'never broken down' : `last broken down ${Math.floor(days)} days ago`;
  return `${where} · ${breaking} · ${candidate.storedVideos} videos stored · ${when}`;
}

export interface Suggestion {
  readonly candidate: Candidate;
  readonly reason: string;
}

/**
 * The channels to break down first: not the owner's own, with enough stored
 * videos, not broken down yet (or long ago), and with something breaking out
 * now; the closest look-alikes with the most and strongest breakouts first.
 */
export function suggestedPicks(
  candidates: readonly Candidate[],
  now: Date,
  count: number = SUGGESTED,
): readonly Suggestion[] {
  return candidates
    .filter(
      (candidate) =>
        !candidate.own &&
        candidate.storedVideos >= MIN_STORED_VIDEOS &&
        candidate.breakingOut > 0 &&
        isDue(candidate, now),
    )
    .map((candidate) => ({ candidate, weight: weight(candidate) }))
    .sort((a, b) => b.weight - a.weight || a.candidate.title.localeCompare(b.candidate.title))
    .slice(0, count)
    .map(({ candidate }) => ({ candidate, reason: reasonFor(candidate, now) }));
}

export interface PickFilters {
  readonly query: string;
  readonly closeOnly: boolean;
  readonly hasBreakouts: boolean;
  readonly notBrokenDown: boolean;
}

export const NO_FILTERS: PickFilters = {
  query: '',
  closeOnly: false,
  hasBreakouts: false,
  notBrokenDown: false,
};

/** The channels that pass the search and the filters, in the order given. */
export function filterCandidates(
  candidates: readonly Candidate[],
  filters: PickFilters,
): readonly Candidate[] {
  const query = filters.query.trim().toLowerCase();
  return candidates.filter(
    (candidate) =>
      (query === '' ||
        candidate.title.toLowerCase().includes(query) ||
        (candidate.handle ?? '').toLowerCase().includes(query)) &&
      (!filters.closeOnly || candidate.closeness === 'close') &&
      (!filters.hasBreakouts || candidate.breakingOut > 0) &&
      (!filters.notBrokenDown || candidate.brokenDownAt === null),
  );
}

const DATE = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

/** "Broken down 3 Nov 2026"; empty when never. */
export const brokenDownText = (iso: string | null): string =>
  iso === null ? '' : `Broken down ${DATE.format(new Date(iso))}`;

/** The short meta line under a channel's name: subscribers and what is breaking out, labelled. */
export function metaLine(candidate: CandidateFacts): readonly string[] {
  return [
    candidate.subscribers === null
      ? 'Subscribers hidden'
      : `${formatCount(candidate.subscribers)} subscribers`,
    `${candidate.breakingOut} breaking out`,
  ];
}
