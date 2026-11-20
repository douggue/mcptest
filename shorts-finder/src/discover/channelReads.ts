/**
 * Reading the facts of channels that are waiting for it. A channel is queued
 * when one of its videos is found; its size and age are what later tell a
 * small new channel from an established one.
 */
import { reasonOf, stopReasonFor, type StopReason } from '../cycleStop';
import type { QuotaLedger } from '../quota/ledger';
import type { Store } from '../repos/types';
import type { YouTubeApi } from '../youtube/api';

const MS_PER_HOUR = 60 * 60 * 1000;
/**
 * A channel's facts are read at most once in 24 hours. Subscriber counts are
 * rounded by the API and move slowly; a day is fine for telling small from
 * large, and it keeps a channel with many videos found from costing many reads.
 */
export const CHANNEL_REREAD_AFTER_MS = 24 * MS_PER_HOUR;
/** The API's limit on channels per request; each request is stored before the next is made. */
const CHANNELS_PER_REQUEST = 50;

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
  /** Entries the API sent that could not be read. Their channels stay queued. */
  readonly skipped: number;
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
  const now = deps.now();
  const queued = deps.store.channels.listQueued();
  let report: ChannelReadsReport = {
    read: 0,
    unavailable: 0,
    skipped: 0,
    leftQueued: queued.length,
    stopped: null,
    failure: null,
  };
  for (const batch of batchesOf(queued)) {
    if (signal?.aborted === true) return { ...report, stopped: 'lease_lost' };
    const result = await deps.api.fetchChannels(batch);
    if (result.error !== null) {
      const stopped = stopReasonFor(result.error, deps.ledger);
      return { ...report, stopped, failure: stopped === null ? reasonOf(result.error) : null };
    }
    const returned = new Set(result.items.map((channel) => channel.id));
    // With an unreadable entry in the reply, an absent channel may be that
    // entry rather than a closed channel, so none is written off.
    const gone = result.skipped > 0 ? [] : batch.filter((id) => !returned.has(id));
    deps.store.transact(() => {
      result.items.forEach((channel) => deps.store.channels.upsert(channel, now));
      gone.forEach((id) => deps.store.channels.markUnavailable(id, now));
    });
    report = {
      ...report,
      read: report.read + result.items.length,
      unavailable: report.unavailable + gone.length,
      skipped: report.skipped + result.skipped,
      leftQueued: report.leftQueued - result.items.length - gone.length,
    };
  }
  return report;
}
