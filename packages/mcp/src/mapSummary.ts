import type { MapSnapshot, SnapshotBreakout, SnapshotChannel } from '@jgtube/core';
import { capped, oneDecimal, withoutAbsent } from './results';

const PERCENT = 100;

export interface MapSummaryOptions {
  /** Also list the channels that are not look-alikes. */
  readonly includeOthers: boolean;
  /** Most channels in each list. */
  readonly limit: number;
}

export interface BreakoutListOptions {
  readonly lookalikesOnly: boolean;
  readonly limit: number;
}

/** A channel on the map in as few characters as carry its meaning. */
function channelEntry(channel: SnapshotChannel): Record<string, unknown> {
  const best = channel.breakout;
  return withoutAbsent({
    id: channel.id,
    title: channel.title,
    subs: channel.subscribers,
    match: Math.round(channel.relevance * PERCENT),
    tier: channel.tier,
    rising: channel.rising ? true : null,
    best: best
      ? { video: best.videoId, title: best.title, views: best.views, score: oneDecimal(best.score) }
      : null,
    why: channel.outsideReason,
  });
}

function channelList(
  key: string,
  moreKey: string,
  channels: readonly SnapshotChannel[],
  limit: number,
): Record<string, unknown> {
  const { shown, more } = capped(channels, limit);
  return { [key]: shown.map(channelEntry), ...(more > 0 ? { [moreKey]: more } : {}) };
}

/** The map around a channel: who is on it and who is like the centre. */
export function summarizeMap(
  snapshot: MapSnapshot,
  options: MapSummaryOptions,
): Record<string, unknown> {
  const { center, model, channels, breakouts } = snapshot;
  const kept = channels.filter((channel) => !channel.removed);
  const lookalikes = kept.filter((channel) => channel.peer);
  const others = kept.filter((channel) => !channel.peer);
  const lookalikeBreakouts = breakouts.filter((video) => video.peer).length;

  return {
    map: {
      id: snapshot.mapId,
      made: snapshot.createdAt,
      depth: snapshot.depth,
      region: snapshot.region,
    },
    center: withoutAbsent({
      id: center.id,
      title: center.title,
      handle: center.handle,
      subs: center.subscribers,
      videos: center.storedVideos,
    }),
    ...(model ? { model: { id: model.id, title: model.title } } : {}),
    counts: {
      channels: channels.length,
      lookalikes: lookalikes.length,
      others: others.length,
      removed: channels.length - kept.length,
      breakouts: lookalikeBreakouts,
      otherBreakouts: breakouts.length - lookalikeBreakouts,
    },
    ...channelList('lookalikes', 'moreLookalikes', lookalikes, options.limit),
    ...(options.includeOthers ? channelList('others', 'moreOthers', others, options.limit) : {}),
  };
}

function breakoutEntry(video: SnapshotBreakout): Record<string, unknown> {
  return withoutAbsent({
    video: video.videoId,
    title: video.title,
    channel: video.channelTitle,
    channelId: video.channelId,
    subs: video.channelSubscribers,
    views: video.views,
    usual: Math.round(video.baseline),
    score: oneDecimal(video.score),
    sample: video.sampleSize,
    hits: `${video.channelHits}/${video.channelScored}`,
    channelAgeDays: video.channelAgeDays === null ? null : Math.round(video.channelAgeDays),
    ageDays: Math.round(video.ageDays),
    published: video.publishedRaw,
    secs: video.durationSeconds,
    caution: video.caution,
    lookalike: video.peer ? null : false,
  });
}

/** Recent videos far above their channel's usual views, strongest first, with the evidence. */
export function summarizeBreakouts(
  snapshot: MapSnapshot,
  options: BreakoutListOptions,
): Record<string, unknown> {
  const wanted = snapshot.breakouts.filter((video) => video.peer || !options.lookalikesOnly);
  const strongestFirst = [...wanted].sort((a, b) => b.score - a.score || b.views - a.views);
  const { shown, more } = capped(strongestFirst, options.limit);
  return {
    center: { id: snapshot.center.id, title: snapshot.center.title },
    shown: shown.length,
    ...(more > 0 ? { more } : {}),
    breakouts: shown.map(breakoutEntry),
  };
}
