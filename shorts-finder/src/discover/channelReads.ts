/**
 * Reading the facts of channels that are waiting for it. A channel is queued
 * when one of its videos is found; its size and age are what later tell a
 * small new channel from an established one.
 */
import { abortReason, reasonOf, stopReasonFor, type StopReason } from '../cycleStop';
import type { QuotaLedger } from '../quota/ledger';
import type { Store } from '../repos/types';
import type { YouTubeApi } from '../youtube/api';
import type { ChannelFacts } from '../youtube/dataApi';

const MS_PER_HOUR = 60 * 60 * 1000;
/**
 * A channel's facts are read at most once in 24 hours. Subscriber counts are
 * rounded by the API and move slowly; a day is fine for telling small from
 * large, and it keeps a channel with many videos found from costing many reads.
 */
export const CHANNEL_REREAD_AFTER_MS = 24 * MS_PER_HOUR;
/** The API's limit on channels per request; each request is stored before the next is made. */
const CHANNELS_PER_REQUEST = 50;
/**
 * A channel whose entry in the reply cannot be read is asked for three times
 * in all, then leaves the queue. An entry that is unreadable three rounds
 * running will not become readable by asking again, and a queue that keeps
 * it costs a unit a round for nothing. It is queued afresh, like any channel,
 * the next time one of its videos is found after a day.
 */
export const MAX_CHANNEL_READ_ATTEMPTS = 3;

export interface ChannelReadsDeps {
  readonly api: Pick<YouTubeApi, 'fetchChannels'>;
  readonly ledger: Pick<QuotaLedger, 'markExhausted'>;
  readonly store: Pick<Store, 'channels' | 'transact'>;
  readonly now: () => Date;
}

export interface ChannelReadsReport {
  /** Channels whose facts were read and stored. */
  readonly read: number;
  /** Channels the API did not return: closed, or hidden. They leave the queue. */
  readonly unavailable: number;
  /** Entries the API sent that could not be read. Their channels stay queued, a few times. */
  readonly skipped: number;
  /** Channels that left the queue after staying unreadable for several reads. */
  readonly gaveUp: number;
  /** Channels still waiting when the reads ended. */
  readonly leftQueued: number;
  readonly stopped: StopReason | null;
  /** Why the reads ended early, when it was a failure rather than a reason to stop. */
  readonly failure: string | null;
}

const batchesOf = (ids: readonly string[]): readonly (readonly string[])[] =>
  Array.from({ length: Math.ceil(ids.length / CHANNELS_PER_REQUEST) }, (_, index) =>
    ids.slice(index * CHANNELS_PER_REQUEST, (index + 1) * CHANNELS_PER_REQUEST),
  );

/**
 * Reads every queued channel, fifty per request, storing each request's
 * channels before making the next. It never throws for a request that fails:
 * the report says what was read, what is still queued and why it ended.
 */
export async function readQueuedChannels(
  deps: ChannelReadsDeps,
  signal?: AbortSignal,
): Promise<ChannelReadsReport> {
  const queued = deps.store.channels.listQueued();
  let report: ChannelReadsReport = {
    read: 0,
    unavailable: 0,
    skipped: 0,
    gaveUp: 0,
    leftQueued: queued.length,
    stopped: null,
    failure: null,
  };
  for (const batch of batchesOf(queued)) {
    const aborted = abortReason(signal);
    if (aborted !== null) return { ...report, stopped: aborted };
    const result = await deps.api.fetchChannels(batch);
    if (result.error !== null) {
      const stopped = stopReasonFor(result.error, deps.ledger);
      return { ...report, stopped, failure: stopped === null ? reasonOf(result.error) : null };
    }
    const settled = storeChannels(deps, batch, result, deps.now());
    report = {
      ...report,
      read: report.read + result.items.length,
      unavailable: report.unavailable + settled.gone,
      skipped: report.skipped + result.skipped,
      gaveUp: report.gaveUp + settled.gaveUp,
      leftQueued: report.leftQueued - result.items.length - settled.gone - settled.gaveUp,
    };
  }
  return report;
}

/** Stores one reply's channels, as read at the time of the reply, and settles the ones it left out. */
function storeChannels(
  deps: ChannelReadsDeps,
  batch: readonly string[],
  result: { readonly items: readonly ChannelFacts[]; readonly skipped: number },
  repliedAt: Date,
): { readonly gone: number; readonly gaveUp: number } {
  const { channels } = deps.store;
  const returned = new Set(result.items.map((channel) => channel.id));
  const absent = batch.filter((id) => !returned.has(id));
  let gaveUp = 0;
  deps.store.transact(() => {
    result.items.forEach((channel) => channels.upsert(channel, repliedAt));
    for (const id of absent) {
      // With an unreadable entry in the reply, an absent channel may be that
      // entry rather than a closed channel: it stays queued, up to a point.
      if (result.skipped === 0) channels.markUnavailable(id, repliedAt);
      else if (channels.countFailedRead(id) >= MAX_CHANNEL_READ_ATTEMPTS) {
        channels.markUnavailable(id, repliedAt);
        gaveUp += 1;
      }
    }
  });
  return { gone: result.skipped === 0 ? absent.length : 0, gaveUp };
}
