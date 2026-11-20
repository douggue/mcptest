/**
 * The other route to a followed channel's new uploads: the newest page of
 * its uploads list through the official API, one unit a channel. It is used
 * only for channels whose public feed is not answering (see `feedCycle.ts`),
 * at most once a day each, so a channel stays watched when YouTube refuses
 * the feeds. This round also lets go of channels that have gone quiet.
 */
import { abortReason, reasonOf, stopReasonFor, type StopReason } from '../cycleStop';
import type { QuotaLedger } from '../quota/ledger';
import type { FollowedChannel, Store } from '../repos/types';
import type { YouTubeApi } from '../youtube/api';
import {
  NO_FINDS,
  detailChannelFinds,
  plusFinds,
  unseenIds,
  type FindsReport,
} from './channelFinds';
import { UNFOLLOW_AFTER_DAYS } from './follow';

const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;
/**
 * Once a day for each channel: a small channel posts a few times a day at
 * most, the list's first page holds fifty uploads, and a day is how often a
 * channel's facts are read as well.
 */
export const UPLOADS_READ_EVERY_MS = 24 * MS_PER_HOUR;
/**
 * What one channel can cost the channel share: its list, and one read of the
 * details of what is new on it. A channel is started only when both fit, so
 * a list that was paid for can always be followed up.
 */
export const UPLOADS_COST_UNITS = 2;
/** Far more channels than a day's channel share could pay for; only bounds a query. */
const MAX_LISTED = 5000;

export interface UploadsDeps {
  readonly api: Pick<YouTubeApi, 'fetchVideos' | 'fetchPlaylistVideoIds'>;
  readonly ledger: Pick<QuotaLedger, 'remaining' | 'markExhausted'>;
  readonly store: Store;
  readonly now: () => Date;
}

export interface UploadsReport {
  /** Channels let go for having no tracked upload in the named number of days. */
  readonly unfollowed: number;
  /** Channels whose uploads list was read. */
  readonly channels: number;
  /** Channels whose uploads list the API does not know. */
  readonly notFound: number;
  /** Due channels not read: the channel share could not pay, or the round stopped. */
  readonly leftUnread: number;
  readonly finds: FindsReport;
  readonly stopped: StopReason | null;
  readonly failure: string | null;
}

type Outcome =
  | { readonly kind: 'read'; readonly notFound: boolean; readonly finds: FindsReport }
  | { readonly kind: 'stopped'; readonly reason: StopReason }
  | { readonly kind: 'failed'; readonly reason: string };

/** Reads one channel's newest uploads and stores the new ones worth tracking. */
async function readUploads(
  deps: UploadsDeps,
  channel: FollowedChannel,
  signal?: AbortSignal,
): Promise<Outcome> {
  try {
    // Listed only with an uploads list; see `listUploadsDue`.
    const list = await deps.api.fetchPlaylistVideoIds(channel.uploadsPlaylistId ?? '');
    const fresh = unseenIds(deps.store, list.videoIds);
    const source = { kind: 'channel_uploads', confirmed: false } as const;
    const finds =
      fresh.length === 0 ? NO_FINDS : await detailChannelFinds(deps, fresh, source, signal);
    // Read, even when its details stopped short: those ids are met again tomorrow.
    deps.store.follows.noteUploadsRead(channel.id, deps.now());
    return { kind: 'read', notFound: list.notFound, finds };
  } catch (error) {
    const reason = stopReasonFor(error, deps.ledger);
    return reason === null
      ? { kind: 'failed', reason: reasonOf(error) }
      : { kind: 'stopped', reason };
  }
}

/**
 * Lets go of quiet channels, then reads the uploads list of each followed
 * channel whose feed is failing and whose uploads have not been read for a
 * day, least-recently-read first, as far as the channel share pays. Never
 * throws for a request that fails.
 */
export async function runUploadsCycle(
  deps: UploadsDeps,
  signal?: AbortSignal,
): Promise<UploadsReport> {
  const now = deps.now();
  const { follows } = deps.store;
  const unfollowed = follows.unfollowIdle(
    new Date(now.getTime() - UNFOLLOW_AFTER_DAYS * MS_PER_DAY),
  );
  const due = follows.listUploadsDue(
    now,
    new Date(now.getTime() - UPLOADS_READ_EVERY_MS),
    MAX_LISTED,
  );
  let report: UploadsReport = {
    unfollowed,
    channels: 0,
    notFound: 0,
    leftUnread: due.length,
    finds: NO_FINDS,
    stopped: null,
    failure: null,
  };
  for (const channel of due) {
    const aborted = abortReason(signal);
    if (aborted !== null) return { ...report, stopped: aborted };
    if (deps.ledger.remaining(deps.now()).byKind.channel < UPLOADS_COST_UNITS) {
      return { ...report, stopped: 'allowance' };
    }
    const outcome = await readUploads(deps, channel, signal);
    if (outcome.kind === 'stopped') return { ...report, stopped: outcome.reason };
    if (outcome.kind === 'failed') return { ...report, failure: outcome.reason };
    report = {
      ...report,
      channels: report.channels + 1,
      notFound: report.notFound + (outcome.notFound ? 1 : 0),
      leftUnread: report.leftUnread - 1,
      finds: plusFinds(report.finds, outcome.finds),
    };
    if (outcome.finds.stopped !== null) return { ...report, stopped: outcome.finds.stopped };
  }
  return report;
}
