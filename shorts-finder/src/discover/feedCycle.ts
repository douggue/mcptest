/**
 * Watching followed channels through their public Shorts feeds. A feed costs
 * nothing of the day's allowance, so it is the first way a followed channel's
 * new Shorts are met; the uploads list of the official API
 * (`followedUploads.ts`) stands in only while a channel's feed does not answer.
 *
 * What a feed gives: new video ids, which are Shorts by YouTube's own listing
 * and are stored as confirmed once their details have been read (the one step
 * that costs units); the same confirmation for videos a search had found; and
 * a view count for videos already tracked, kept as a reading marked `feed`.
 *
 * Reading feeds needs no lease and spends nothing. It still stops when the
 * service does, backs off channel by channel, and gives up for a while when
 * YouTube refuses several feeds in a row.
 */
import { abortReason, type StopReason } from '../cycleStop';
import type { FollowedChannel, ServiceStateRepo, Store } from '../repos/types';
import { TRACKED_UNTIL_MS } from '../track/tiers';
import type { FeedEntry, FeedResult, FeedValidators } from '../youtube/feed';
import { NO_FINDS, unseenIds, type FindsReport } from './channelFinds';

const MS_PER_MINUTE = 60 * 1000;
/**
 * A channel's feed is read at most every 30 minutes. YouTube lets a feed be
 * cached for 900 seconds, so asking more often than that returns the same
 * document; twice the cache's life means every read can be a new one, and a
 * new Short is met within the half hour.
 */
export const FEED_POLL_EVERY_MS = 30 * MS_PER_MINUTE;
/** At most three feeds are being fetched at once: quick enough, and gentle on one host. */
export const FEED_CONCURRENCY = 3;
/** Each fetch waits a random part of two seconds first, so the requests do not arrive in step. */
export const FEED_JITTER_MS = 2000;
/**
 * A feed that fails is left for half an hour, then twice as long after each
 * further failure in a row, up to a day: a channel without a Shorts list
 * answers "not found" every time and should cost one request a day, not 48.
 */
export const FEED_BACKOFF_BASE_MS = 30 * MS_PER_MINUTE;
export const FEED_BACKOFF_MAX_MS = 24 * 60 * MS_PER_MINUTE;
/**
 * Five feeds failing one after another is not five channels at fault: it is
 * YouTube refusing this address, or the network down. The round ends there.
 * "Not found" does not count: that answer is about one channel.
 */
export const FEED_STOP_AFTER_FAILURES = 5;
/** After such a round no feed is asked for during an hour. */
export const FEED_REFUSED_PAUSE_MS = 60 * MS_PER_MINUTE;
/** One round reads at most this many feeds, so a look never runs for many minutes. */
export const FEED_MAX_PER_CYCLE = 150;
/** Where the end of a pause is remembered, so a restart keeps to it. */
export const FEEDS_PAUSED_UNTIL = 'feeds.pausedUntil';

/** Reads one channel's Shorts feed; the service binds it to the network. */
export type ReadFeed = (
  channelId: string,
  validators: FeedValidators | null,
  signal?: AbortSignal,
) => Promise<FeedResult>;

export interface FeedCycleDeps {
  readonly store: Store;
  readonly now: () => Date;
  readonly readFeed: ReadFeed;
  /**
   * Reads the details of new ids and stores the ones worth tracking. The one
   * step that spends units; the service runs it under the YouTube lease.
   */
  readonly detail: (ids: readonly string[], signal?: AbortSignal) => Promise<FindsReport>;
  /** Replace the wait and the dice; used by tests. */
  readonly sleep?: (ms: number) => Promise<void>;
  readonly random?: () => number;
}

export interface FeedCycleReport {
  /** Feeds asked for. */
  readonly channels: number;
  /** Feeds that answered, with a document or with "not changed". */
  readonly answered: number;
  /** Channels YouTube has no Shorts feed for. */
  readonly notFound: number;
  readonly failed: number;
  /** Stored videos newly marked as confirmed Shorts. */
  readonly confirmed: number;
  /** View counts kept as readings for videos already tracked. */
  readonly readings: number;
  /** True when the round ended because several feeds in a row failed. */
  readonly refused: boolean;
  /** What reading the details of the new ids came to. */
  readonly finds: FindsReport;
  readonly stopped: StopReason | null;
  /** The last failure's words, when any feed failed. */
  readonly failure: string | null;
}

const NOTHING: FeedCycleReport = {
  channels: 0,
  answered: 0,
  notFound: 0,
  failed: 0,
  confirmed: 0,
  readings: 0,
  refused: false,
  finds: NO_FINDS,
  stopped: null,
  failure: null,
};

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** Whether a pause after a refused round is still on; one further off than a pause is long is not. */
export function feedsPaused(state: ServiceStateRepo, now: Date): boolean {
  const until = new Date(state.get(FEEDS_PAUSED_UNTIL) ?? '').getTime();
  const left = until - now.getTime();
  return Number.isFinite(left) && left > 0 && left <= FEED_REFUSED_PAUSE_MS;
}

/** How long a feed is left alone after its nth failure in a row. */
export const feedBackoffMs = (failures: number): number =>
  Math.min(FEED_BACKOFF_MAX_MS, FEED_BACKOFF_BASE_MS * 2 ** Math.max(0, failures - 1));

interface Applied {
  readonly confirmed: number;
  readonly readings: number;
  /** Ids not stored yet and young enough to track. */
  readonly fresh: readonly string[];
}

/**
 * Takes what one feed says: confirms the stored videos it lists, keeps their
 * view counts as readings, and returns the ids not stored yet. Entries that
 * name another channel are ignored: the feed is untrusted.
 */
export function applyFeed(
  store: Store,
  channelId: string,
  entries: readonly FeedEntry[],
  at: Date,
): Applied {
  let confirmed = 0;
  let readings = 0;
  let fresh: readonly string[] = [];
  for (const entry of entries.filter((candidate) => candidate.channelId === channelId)) {
    const video = store.videos.get(entry.videoId);
    const tracked = video === null ? null : store.tracking.get(entry.videoId);
    if (video === null) {
      const young = at.getTime() - entry.publishedAt.getTime() < TRACKED_UNTIL_MS;
      if (young) fresh = [...fresh, entry.videoId];
    } else if (tracked !== null && tracked.tier !== 'done') {
      if (tracked.isShort === 'yes' || tracked.isShort === 'unknown') {
        store.tracking.classify(entry.videoId, 'confirmed');
        confirmed += 1;
      }
      // A feed can be a quarter of an hour old. A count below the last one
      // the API gave is that staleness, not a loss of views, and is not kept.
      if (entry.views !== null && entry.views >= (video.views ?? 0)) {
        const reading = { videoId: entry.videoId, capturedAt: at, views: entry.views };
        store.readings.add({ ...reading, source: 'feed' });
        readings += 1;
      }
    }
  }
  return { confirmed, readings, fresh };
}

interface Polled {
  readonly channel: FollowedChannel;
  readonly result: FeedResult;
}

const validatorsOf = (channel: FollowedChannel): FeedValidators | null =>
  channel.feedEtag === null && channel.feedModified === null
    ? null
    : { etag: channel.feedEtag, lastModified: channel.feedModified };

/** Fetches a few feeds at once, each after a short random wait. */
function pollGroup(
  deps: FeedCycleDeps,
  group: readonly FollowedChannel[],
  signal?: AbortSignal,
): Promise<readonly Polled[]> {
  const sleep = deps.sleep ?? defaultSleep;
  const random = deps.random ?? Math.random;
  return Promise.all(
    group.map(async (channel): Promise<Polled> => {
      await sleep(Math.floor(random() * FEED_JITTER_MS));
      return { channel, result: await deps.readFeed(channel.id, validatorsOf(channel), signal) };
    }),
  );
}

interface Round {
  readonly report: FeedCycleReport;
  readonly fresh: readonly string[];
  /** Feeds that failed one after another, up to now. */
  readonly failuresInARow: number;
}

/** Records one feed's answer in the store and in the round's tally. */
function settle(deps: FeedCycleDeps, round: Round, polled: Polled): Round {
  const { store } = deps;
  const { channel, result } = polled;
  const at = deps.now();
  const report = { ...round.report, channels: round.report.channels + 1 };
  if (result.kind === 'ok' || result.kind === 'not_modified') {
    const kept = { etag: channel.feedEtag, lastModified: channel.feedModified };
    const validators = result.kind === 'ok' ? result.validators : kept;
    let applied: Applied = { confirmed: 0, readings: 0, fresh: [] };
    store.transact(() => {
      store.follows.noteFeedRead(channel.id, {
        at,
        etag: validators.etag,
        modified: validators.lastModified,
      });
      if (result.kind === 'ok') applied = applyFeed(store, channel.id, result.entries, at);
    });
    return {
      report: {
        ...report,
        answered: report.answered + 1,
        confirmed: report.confirmed + applied.confirmed,
        readings: report.readings + applied.readings,
      },
      fresh: [...round.fresh, ...applied.fresh],
      failuresInARow: 0,
    };
  }
  const retryAt = new Date(at.getTime() + feedBackoffMs(channel.feedFailures + 1));
  store.follows.noteFeedFailure(channel.id, at, retryAt);
  if (result.kind === 'not_found') {
    return { ...round, report: { ...report, notFound: report.notFound + 1 }, failuresInARow: 0 };
  }
  return {
    ...round,
    report: { ...report, failed: report.failed + 1, failure: result.message },
    failuresInARow: round.failuresInARow + 1,
  };
}

const groupsOf = (channels: readonly FollowedChannel[]): readonly (readonly FollowedChannel[])[] =>
  Array.from({ length: Math.ceil(channels.length / FEED_CONCURRENCY) }, (_, index) =>
    channels.slice(index * FEED_CONCURRENCY, (index + 1) * FEED_CONCURRENCY),
  );

/** Reads the due feeds, a few at a time, until done, stopped or refused. */
async function pollAll(
  deps: FeedCycleDeps,
  due: readonly FollowedChannel[],
  signal?: AbortSignal,
): Promise<Round> {
  let round: Round = { report: NOTHING, fresh: [], failuresInARow: 0 };
  for (const group of groupsOf(due)) {
    const before = abortReason(signal);
    if (before !== null) return { ...round, report: { ...round.report, stopped: before } };
    const polled = await pollGroup(deps, group, signal);
    // A fetch cut short by the stop is not a failure of the feed: nothing of it is recorded.
    const after = abortReason(signal);
    if (after !== null) return { ...round, report: { ...round.report, stopped: after } };
    for (const answer of polled) round = settle(deps, round, answer);
    if (round.failuresInARow >= FEED_STOP_AFTER_FAILURES) {
      const until = new Date(deps.now().getTime() + FEED_REFUSED_PAUSE_MS);
      deps.store.state.set(FEEDS_PAUSED_UNTIL, until.toISOString(), deps.now());
      return { ...round, report: { ...round.report, refused: true } };
    }
  }
  return round;
}

/**
 * Reads the Shorts feed of every followed channel whose turn has come, then
 * the details of the new videos they list. Returns null when there was
 * nothing to do: no feed is due, or a pause is on. Never throws for a feed
 * that fails.
 */
export async function runFeedCycle(
  deps: FeedCycleDeps,
  signal?: AbortSignal,
): Promise<FeedCycleReport | null> {
  const now = deps.now();
  if (feedsPaused(deps.store.state, now)) return null;
  const checkedBefore = new Date(now.getTime() - FEED_POLL_EVERY_MS);
  const due = deps.store.follows.listFeedDue(now, checkedBefore, FEED_MAX_PER_CYCLE);
  if (due.length === 0) return null;
  const { report, fresh } = await pollAll(deps, due, signal);
  const unseen = unseenIds(deps.store, fresh);
  if (unseen.length === 0 || report.stopped !== null) return report;
  const finds = await deps.detail(unseen, signal);
  return { ...report, finds, stopped: finds.stopped };
}

/** The most channels one call to `confirmCandidates` looks at. */
export const CONFIRM_MAX_CHANNELS = 20;

export interface ConfirmReport {
  /** Channels whose Shorts feed was asked for. */
  readonly checked: number;
  /** Stored videos this call marked as confirmed Shorts. */
  readonly confirmed: number;
  /** Channels whose feed did not answer; their videos stay as they were. */
  readonly unanswered: number;
  /** Channels given beyond the limit and not looked at. */
  readonly leftUnchecked: number;
}

/**
 * Checks the Shorts feeds of the given channels and marks as confirmed the
 * stored videos they list. For the step that makes findings: a candidate
 * found by search is a confirmed Short when its channel's Shorts feed has it.
 * Bounded: at most `CONFIRM_MAX_CHANNELS` feeds, one after another, stopping
 * when told to. A video the feed does not list is left as it was; fifteen
 * entries is all a feed holds, so absence proves nothing.
 */
export async function confirmCandidates(
  deps: Pick<FeedCycleDeps, 'store' | 'now' | 'readFeed'>,
  channelIds: readonly string[],
  signal?: AbortSignal,
): Promise<ConfirmReport> {
  const unique = [...new Set(channelIds)];
  const chosen = unique.slice(0, CONFIRM_MAX_CHANNELS);
  let report: ConfirmReport = {
    checked: 0,
    confirmed: 0,
    unanswered: 0,
    leftUnchecked: unique.length - chosen.length,
  };
  for (const channelId of chosen) {
    if (abortReason(signal) !== null) break;
    const result = await deps.readFeed(channelId, null, signal);
    const applied =
      result.kind === 'ok' ? applyFeed(deps.store, channelId, result.entries, deps.now()) : null;
    report = {
      ...report,
      checked: report.checked + 1,
      confirmed: report.confirmed + (applied?.confirmed ?? 0),
      unanswered: report.unanswered + (applied === null ? 1 : 0),
    };
  }
  return report;
}
