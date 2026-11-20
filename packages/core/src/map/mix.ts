/**
 * The look-alikes of a map in two groups, and the order that mixes them.
 *
 * The owner asked that the channels like theirs be shown as roughly 70%
 * channels that have already taken off and 30% channels that are rising. The
 * matching rules decide who is a look-alike; nothing here changes that. This
 * file decides which group a channel is in and the order the look-alikes are
 * listed in, so that the first six, twelve or eighteen shown keep that mix.
 *
 * Nothing in it looks at a title, a subject or one channel: every number is
 * about views, uploads and dates. This file must not load anything: the web
 * app uses the order too, and anything loaded here would be bundled for the
 * browser.
 */

/** 'neither': a look-alike that has not taken off and is not rising. It stays a look-alike. */
export type ChannelGroup = 'taken-off' | 'rising' | 'neither';

/** The share of the look-alikes shown that have already taken off: the owner's own number. */
export const MIX_TAKEN_OFF_PERCENT = 70;

/**
 * How far back "taken off" looks. Three months is the window the niche list
 * judges demand over (`NICHE_LONG_WINDOW_DAYS`): one month swings with a
 * single video, and further back is no longer what works now.
 */
export const TAKEN_OFF_WINDOW_DAYS = 90;
/**
 * An upload with this many views was widely seen. It is the floor the niche
 * list already sets for a video that means something (`NICHE_MIN_VIDEO_VIEWS`):
 * under it, a few hundred people decide the number.
 */
export const TAKEN_OFF_MIN_VIDEO_VIEWS = 10_000;
/**
 * A channel has taken off when this many of its uploads in the window were
 * widely seen. One can be luck and two a coincidence; three inside three
 * months is a pattern, and it is the fewest videos an outlier score needs to
 * compare with.
 */
export const TAKEN_OFF_MIN_VIDEOS = 3;
/**
 * And its uploads in the window drew this many views together: ten times the
 * floor for one video. Three uploads at the floor come to 30,000, so reaching
 * this takes either real hits or a body of work around them.
 */
export const TAKEN_OFF_MIN_WINDOW_VIEWS = 100_000;
/**
 * And those views are at least this many times its subscribers. A channel
 * whose uploads of three months were seen fewer times than it has subscribers
 * is living off an audience that has stopped watching: it took off once and is
 * not doing so now. A channel that hides its count is judged on views alone.
 */
export const TAKEN_OFF_MIN_VIEWS_PER_SUBSCRIBER = 1;

/** What a channel's group is read from. */
export interface GroupEvidence {
  /**
   * A channel whose first upload is under 90 days old and that is already far
   * above its size: the map's existing `rising` flag (`channelMetrics`).
   */
  readonly rising: boolean;
  /** Views on its uploads of the last `TAKEN_OFF_WINDOW_DAYS` days. */
  readonly windowViews: number;
  /** How many of those uploads have `TAKEN_OFF_MIN_VIDEO_VIEWS` views or more. */
  readonly widelySeenUploads: number;
  /** Null when the channel hides its count. */
  readonly subscribers: number | null;
}

/**
 * Which group a channel is in. "Taken off" is asked first: a channel whose
 * uploads are already widely seen again and again has taken off however young
 * it is. Rising is what is left of the young channels far above their size:
 * first signs, with small totals so far. So a channel is in exactly one group,
 * or in neither.
 */
export function channelGroup(evidence: GroupEvidence): ChannelGroup {
  const { windowViews, widelySeenUploads, subscribers } = evidence;
  const holdsItsSize =
    subscribers === null || windowViews >= subscribers * TAKEN_OFF_MIN_VIEWS_PER_SUBSCRIBER;
  const takenOff =
    widelySeenUploads >= TAKEN_OFF_MIN_VIDEOS &&
    windowViews >= TAKEN_OFF_MIN_WINDOW_VIEWS &&
    holdsItsSize;
  if (takenOff) return 'taken-off';
  return evidence.rising ? 'rising' : 'neither';
}

const PERCENT = 100;

/** How many of the first `shown` places belong to channels that have taken off. */
const takenOffPlaces = (shown: number): number =>
  Math.round((MIX_TAKEN_OFF_PERCENT * shown) / PERCENT);

/**
 * The same items with the two groups interleaved, so that any number shown
 * from the front holds as close to 70% taken off and 30% rising as whole
 * channels allow. Each group keeps the order it came in. When one group runs
 * out the other fills its places, and the items in neither group follow at
 * the end: they are the look-alikes with the least to show. The list given is
 * not changed, and mixing a mixed list gives it back.
 */
export function mixOrder<T>(items: readonly T[], groupOf: (item: T) => ChannelGroup): readonly T[] {
  const takenOff = items.filter((item) => groupOf(item) === 'taken-off');
  const rising = items.filter((item) => groupOf(item) === 'rising');
  const neither = items.filter((item) => groupOf(item) === 'neither');
  const mixed: T[] = [];
  let taken = 0;
  let risen = 0;
  while (taken < takenOff.length || risen < rising.length) {
    const wantsTakenOff = taken < takenOffPlaces(taken + risen + 1);
    const takesTakenOff = risen >= rising.length || (wantsTakenOff && taken < takenOff.length);
    if (takesTakenOff) {
      mixed.push(...takenOff.slice(taken, taken + 1));
      taken += 1;
    } else {
      mixed.push(...rising.slice(risen, risen + 1));
      risen += 1;
    }
  }
  return [...mixed, ...neither];
}

export interface MixSplit {
  readonly takenOff: number;
  readonly rising: number;
  readonly neither: number;
}

/** How many of the items are in each group. */
export function mixSplit<T>(items: readonly T[], groupOf: (item: T) => ChannelGroup): MixSplit {
  const count = (group: ChannelGroup): number =>
    items.filter((item) => groupOf(item) === group).length;
  return { takenOff: count('taken-off'), rising: count('rising'), neither: count('neither') };
}
