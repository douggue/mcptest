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

const DAY_MS = 24 * 60 * 60 * 1000;
/**
 * An account this much older than its first upload was not made for these
 * videos: it sat unused, or had its old videos removed, and started again.
 * Under two months is the ordinary gap between making an account and posting.
 */
const RESTART_MIN_GAP_DAYS = 60;
const COUNTRY_CODE = /^[A-Z]{2}$/;
/** The standard's own code for "no known country", which has a name but says nothing. */
const UNKNOWN_REGION = 'ZZ';
const regionNames = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' });

/** The country's name in English, or null for a code that is not a known country. */
function countryName(code: string | null): string | null {
  if (code === null || code === UNKNOWN_REGION || !COUNTRY_CODE.test(code)) return null;
  try {
    return regionNames.of(code) ?? null;
  } catch {
    return null;
  }
}

/** When the channel started: the account's year beside the first upload when the two are far apart. */
function describeStart(channel: NicheChannel, now: Date): string | null {
  const created = channel.createdAt === null ? Number.NaN : new Date(channel.createdAt).getTime();
  const account = Number.isNaN(created)
    ? null
    : { year: new Date(created).getUTCFullYear(), ageDays: (now.getTime() - created) / DAY_MS };
  if (channel.channelAgeDays === null) return account ? `Account from ${account.year}` : null;
  const age = formatAge(channel.channelAgeDays);
  return account && account.ageDays - channel.channelAgeDays > RESTART_MIN_GAP_DAYS
    ? `Account from ${account.year}, restarted ${age} ago`
    : `First upload about ${age} ago`;
}

/**
 * When a channel started and where it is from, as far as each is known; empty
 * when neither is. The account's creation date and the country come from the
 * official API, so they are missing until a refresh or a search has asked.
 */
export function describeOrigin(channel: NicheChannel, now: Date = new Date()): string {
  const start = describeStart(channel, now);
  const country = countryName(channel.country);
  return [...(start ? [start] : []), ...(country ? [country] : [])].join(' · ');
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

/**
 * What the views on a channel's last 30 days of uploads are worth, in words.
 * It is not called monthly income: these are the views those videos have so
 * far, not views received in a month.
 */
export function describeEarnings(estimate: EarningsEstimate): string {
  if (estimate.high <= 0) return 'No uploads in the last 30 days to estimate from';
  const range = `${dollars.format(estimate.low)}–${dollars.format(estimate.high)}`;
  const worth = `Views on the last 30 days of uploads are worth about ${range}`;
  return estimate.belowAdThreshold
    ? `${worth}, but under 1,000 subscribers it cannot earn from ads yet`
    : worth;
}

/** What a keyword search found, in one sentence. */
export function describeSearch(summary: SearchSummary): string {
  if (summary.videosFound === 0) return `No recent videos were found for "${summary.keyword}".`;
  const unread = summary.failed > 0 ? `, ${summary.failed} could not be read` : '';
  const dates = summary.factsProblem
    ? ` Account dates could not be read: ${summary.factsProblem}`
    : '';
  return `Found ${summary.videosFound} videos from ${summary.channelsFound} channels for "${summary.keyword}": ${summary.added} new to Jgtube, ${summary.alreadyKnown} already known${unread}.${dates}`;
}

/** What a channel's videos gained between its first and latest stored reading, in words. */
export function describeGrowth(growth: NicheGrowth): string {
  return `Gained ${formatCount(growth.views)} views in ${formatAge(growth.days)}`;
}
