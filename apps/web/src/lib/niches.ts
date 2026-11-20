import type {
  EarningsEstimate,
  NicheChannel,
  NicheGrowth,
  NicheList,
  NicheSample,
} from '@jgtube/core';
import type { SearchSummary } from './api';
import { formatAge, formatCount } from './format';

/** 'new' and 'small' show the channels listed for that reason; 'watched' the ones the owner marked. */
export type NicheFilter = 'all' | 'new' | 'small' | 'watched';

export const NICHE_FILTERS: readonly { readonly id: NicheFilter; readonly label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'new', label: 'New' },
  { id: 'small', label: 'Small' },
  { id: 'watched', label: 'Watched only' },
];

export function filterNiches(
  channels: readonly NicheChannel[],
  filter: NicheFilter,
): readonly NicheChannel[] {
  if (filter === 'all') return channels;
  if (filter === 'watched') return channels.filter((channel) => channel.watched);
  return channels.filter((channel) => channel.reasons.includes(filter));
}

/** The same list with one channel marked as watched or not. */
export function withWatched(list: NicheList, channelId: string, watched: boolean): NicheList {
  return {
    ...list,
    channels: list.channels.map((channel) =>
      channel.id === channelId ? { ...channel, watched } : channel,
    ),
  };
}

/** A channel's handle and how long ago it first published, as far as either is known. */
export function describeChannel(channel: NicheChannel): string {
  return [
    ...(channel.handle ? [`@${channel.handle}`] : []),
    ...(channel.channelAgeDays === null
      ? []
      : [`first upload about ${formatAge(channel.channelAgeDays)} ago`]),
  ].join(' · ');
}

/** In words, what the list holds and how much was gone through to make it. */
export function describeList(list: NicheList): string {
  const count = list.channels.length;
  if (count === 0) {
    return 'New or small channels with a recent video far above their size or their usual views, from every channel Jgtube has read.';
  }
  const one = count === 1;
  const its = one ? 'its' : 'their';
  const read = `${list.channelsChecked} channel${list.channelsChecked === 1 ? '' : 's'}`;
  return [
    `${count} ${one ? 'channel that is' : 'channels that are'}`,
    `new (first upload in the last ${list.newMaxAgeDays} days)`,
    `or small (${formatCount(list.smallMaxSubscribers)} subscribers or fewer)`,
    `with a recent video far above ${its} size or ${its} usual views,`,
    `found among the ${read} Jgtube has read. Most views first.`,
  ].join(' ');
}

/** In words, how often a channel's recent videos go far above its usual views. */
export function describeHits(channel: Pick<NicheChannel, 'hitCount' | 'scoredCount'>): string {
  if (channel.scoredCount === 0) return 'Too few videos to tell a one-off from a pattern';
  const noun = channel.scoredCount === 1 ? 'video' : 'videos';
  return `${channel.hitCount} of ${channel.scoredCount} recent ${noun} took off`;
}

/** Views for each subscriber; a dash when the subscriber count is hidden. */
export function formatPerSubscriber(viewsPerSubscriber: number | null): string {
  if (viewsPerSubscriber === null) return '—';
  return viewsPerSubscriber < 10
    ? viewsPerSubscriber.toFixed(1)
    : formatCount(Math.round(viewsPerSubscriber));
}

/** The channel's most viewed recent titles, less the ones already shown as videos that took off. */
export function otherTitles(channel: NicheChannel): readonly NicheSample[] {
  const shown = new Set(channel.outperformers.map((video) => video.videoId));
  return channel.sampleTitles.filter((sample) => !shown.has(sample.videoId));
}

const dollars = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  // Currency formats default to two decimals; "$84.00" would claim a precision the estimate lacks.
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
});

/** The monthly earnings range in words, with what it cannot know said plainly. */
export function describeEarnings(estimate: EarningsEstimate): string {
  if (estimate.high <= 0) return 'No recent views to estimate from';
  const range = `${dollars.format(estimate.low)}–${dollars.format(estimate.high)} a month`;
  return estimate.belowAdThreshold
    ? `Views worth about ${range}, but under 1,000 subscribers it cannot earn from ads yet`
    : `About ${range}`;
}

/** What a keyword search found, in one sentence. */
export function describeSearch(summary: SearchSummary): string {
  if (summary.videosFound === 0) return `No recent videos were found for "${summary.keyword}".`;
  const unread = summary.failed > 0 ? `, ${summary.failed} could not be read` : '';
  return `Found ${summary.videosFound} videos from ${summary.channelsFound} channels for "${summary.keyword}": ${summary.added} new to Jgtube, ${summary.alreadyKnown} already known${unread}.`;
}

/** What a channel's videos gained between its first and latest stored reading, in words. */
export function describeGrowth(growth: NicheGrowth): string {
  return `Gained ${formatCount(growth.views)} views in ${formatAge(growth.days)}`;
}
