import { DEFAULT_BREAKOUT_WINDOW_DAYS, DEFAULT_MIN_BREAKOUT_SCORE } from '../map/breakouts';
import type { ChannelGroup } from '../map/mix';
import { channelMetrics } from '../map/view';
import { buildVideoReport, type VideoReportRow } from '../report';
import type { StoredChannel, StoredVideo, VideoReading } from '../repos/types';
import { hadReadingBy, videosAsOf } from './asOf';
import {
  CHANGES_FORMAT_MIN_BREAKOUTS,
  breakoutFormats,
  type BreakoutFormat,
  type TitledBreakout,
} from './formats';

/**
 * What changed among a map's look-alikes between an earlier moment and now,
 * worked out from stored readings alone. The earlier state is the store as
 * it was then (`videosAsOf`), judged by the same rules as today: a breakout
 * is a video of the last month at twice its channel's usual views or more,
 * and a channel's group is the one the map gives it.
 *
 * A channel with no reading by the earlier moment cannot be compared, so
 * nothing of it is called new: it is counted and said. The subscriber count
 * is the latest one in both states, since no history of it is kept.
 */

export { CHANGES_FORMAT_MIN_BREAKOUTS };
/** New breakouts shown, strongest first; the full count is always given. */
export const CHANGES_BREAKOUTS_SHOWN = 12;
/** Title formats shown. */
export const CHANGES_FORMATS_SHOWN = 6;

/** One look-alike with its stored videos and every reading of them. */
export interface ChannelHistory {
  readonly channel: StoredChannel;
  readonly videos: readonly StoredVideo[];
  readonly readings: readonly VideoReading[];
}

export interface ChangesInput {
  readonly lookalikes: readonly ChannelHistory[];
  readonly since: Date;
  readonly now: Date;
}

/**
 * 'not-stored': the video had not been read by the earlier moment.
 * 'below': it was stored then and scored under the breakout bar, or had no score.
 */
export type BreakoutBefore = 'not-stored' | 'below';

export interface NewBreakout extends TitledBreakout {
  /** Multiple of the channel's usual views now. */
  readonly score: number;
  readonly ageDays: number;
  readonly publishedRaw: string;
  readonly was: BreakoutBefore;
  /** Its views and score at the earlier moment; null when it was not stored or had no score. */
  readonly viewsThen: number | null;
  readonly scoreThen: number | null;
}

export interface GroupChange {
  readonly channelId: string;
  readonly title: string;
  readonly was: ChannelGroup;
  readonly now: ChannelGroup;
}

export interface GroupChanges {
  readonly takenOff: readonly GroupChange[];
  readonly rising: readonly GroupChange[];
  /** Had taken off or was rising then, and is neither now. */
  readonly droppedOut: readonly GroupChange[];
}

export interface MapChanges {
  /** Look-alikes that had a reading by the earlier moment, and those that had none. */
  readonly comparedChannels: number;
  readonly uncomparedChannels: number;
  readonly newBreakouts: readonly NewBreakout[];
  /** Every new breakout, including those not shown. */
  readonly newBreakoutCount: number;
  readonly groups: GroupChanges;
  /** Formats several breakouts share now that the breakouts then did not. */
  readonly formats: readonly BreakoutFormat[];
}

const isBreakout = (row: VideoReportRow): boolean =>
  row.score !== null &&
  row.score >= DEFAULT_MIN_BREAKOUT_SCORE &&
  row.ageDays <= DEFAULT_BREAKOUT_WINDOW_DAYS;

interface ChannelChange {
  readonly fresh: readonly NewBreakout[];
  /** Every breakout of the channel now, and those it had then, for the formats. */
  readonly breakoutsNow: readonly TitledBreakout[];
  readonly breakoutsThen: readonly TitledBreakout[];
  readonly group: GroupChange | null;
}

/** What changed on one channel that had been read by the earlier moment. */
function channelChange(history: ChannelHistory, since: Date, now: Date): ChannelChange {
  const { channel, videos, readings } = history;
  const earlier = videosAsOf(videos, readings, since);
  const then = new Map(buildVideoReport(earlier, since).map((row) => [row.id, row]));
  const titled = (row: VideoReportRow): TitledBreakout => ({
    videoId: row.id,
    title: row.title,
    channelId: channel.id,
    channelTitle: channel.title,
    views: row.views,
  });
  const nowRows = buildVideoReport(videos, now).filter(isBreakout);
  const fresh = nowRows.flatMap((row): NewBreakout[] => {
    const before = then.get(row.id);
    if (before && isBreakout(before)) return [];
    return [
      {
        ...titled(row),
        score: row.score ?? 0,
        ageDays: row.ageDays,
        publishedRaw: row.publishedRaw,
        was: before ? 'below' : 'not-stored',
        viewsThen: before?.views ?? null,
        scoreThen: before?.score ?? null,
      },
    ];
  });
  const groupNow = channelMetrics(videos, channel.subscribers, now).group;
  const groupThen = channelMetrics(earlier, channel.subscribers, since).group;
  return {
    fresh,
    breakoutsNow: nowRows.map(titled),
    breakoutsThen: [...then.values()].filter(isBreakout).map(titled),
    group:
      groupNow === groupThen
        ? null
        : { channelId: channel.id, title: channel.title, was: groupThen, now: groupNow },
  };
}

function groupChanges(changes: readonly GroupChange[]): GroupChanges {
  return {
    takenOff: changes.filter((change) => change.now === 'taken-off'),
    rising: changes.filter((change) => change.now === 'rising'),
    droppedOut: changes.filter((change) => change.now === 'neither'),
  };
}

/** The formats several breakouts share now that no several of the earlier breakouts shared. */
function newFormats(changes: readonly ChannelChange[]): readonly BreakoutFormat[] {
  const before = new Set(
    breakoutFormats(changes.flatMap((change) => change.breakoutsThen)).map(
      (format) => format.template,
    ),
  );
  const freshIds = new Set(changes.flatMap((change) => change.fresh.map((entry) => entry.videoId)));
  return breakoutFormats(changes.flatMap((change) => change.breakoutsNow))
    .filter(
      (format) =>
        !before.has(format.template) && format.videos.some((video) => freshIds.has(video.videoId)),
    )
    .slice(0, CHANGES_FORMATS_SHOWN);
}

/** What changed among the look-alikes between `since` and `now`. */
export function mapChanges(input: ChangesInput): MapChanges {
  const { lookalikes, since, now } = input;
  const comparable = lookalikes.filter((history) => hadReadingBy(history.readings, since));
  const changes = comparable.map((history) => channelChange(history, since, now));
  const fresh = changes
    .flatMap((change) => change.fresh)
    .sort((a, b) => b.score - a.score || b.views - a.views);
  return {
    comparedChannels: comparable.length,
    uncomparedChannels: lookalikes.length - comparable.length,
    newBreakouts: fresh.slice(0, CHANGES_BREAKOUTS_SHOWN),
    newBreakoutCount: fresh.length,
    groups: groupChanges(changes.flatMap((change) => change.group ?? [])),
    formats: newFormats(changes),
  };
}
