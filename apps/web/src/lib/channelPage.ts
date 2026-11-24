/**
 * One channel's page: its tabs, the line under its name that says how it
 * relates to the owner's channel, and its videos as the page lists them.
 */
import type { ChannelProfile, MapSnapshot, ProfileVideo } from '@jgtube/core';
import { formatCount, formatScore } from './format';
import { CHANNEL_TABS, channelHref, type ChannelTab } from './routes';
import type { PageTab } from './videoPage';

export const CHANNEL_TAB_LABELS: Readonly<Record<ChannelTab, string>> = {
  overview: 'Overview',
  videos: 'Videos',
  thumbnails: 'Thumbnails',
  breakdown: 'Breakdown',
};

/** The tabs of a channel's page, each at its own address; Videos carries how many are stored. */
export const channelTabs = (
  channelId: string,
  storedVideos: number | null,
): readonly (PageTab & { readonly count?: string })[] =>
  CHANNEL_TABS.map((tab) => ({
    key: tab,
    label: CHANNEL_TAB_LABELS[tab],
    href: channelHref(channelId, tab),
    ...(tab === 'videos' && storedVideos !== null ? { count: formatCount(storedVideos) } : {}),
  }));

export type Closeness = 'close' | 'medium' | 'far';

/** How a channel sits on the map on screen. */
export interface OnMap {
  /** A competitor: a look-alike the owner has not removed. */
  readonly competitor: boolean;
  readonly closeness: Closeness;
  /** The channel the map is centred on. */
  readonly center: { readonly id: string; readonly title: string };
}

type MapParts = Pick<MapSnapshot, 'center' | 'channels'>;

/** How the channel sits on the map on screen; null when it is not on it, or is its centre. */
export function onMapOf(channelId: string, map: MapParts | null): OnMap | null {
  const found = map?.channels.find((channel) => channel.id === channelId);
  if (!map || !found) return null;
  return {
    competitor: found.peer && !found.removed,
    closeness: found.tier,
    center: { id: map.center.id, title: map.center.title },
  };
}

/** The words before the centre's name, under the channel's own. */
export const relationWords = (onMap: OnMap): string =>
  onMap.competitor ? 'competitor of' : 'on the map of';

/** The channel's videos as its Videos tab lists them: outliers first, then the newest of the rest. */
export function pageVideos(profile: Pick<ChannelProfile, 'top' | 'recent'>): {
  readonly outliers: readonly ProfileVideo[];
  readonly newest: readonly ProfileVideo[];
} {
  const inTop = new Set(profile.top.map((video) => video.videoId));
  return {
    outliers: profile.top,
    newest: profile.recent.filter((video) => !inTop.has(video.videoId)),
  };
}

/** A video's line under its title on a channel's page. */
export const profileVideoMeta = (video: Pick<ProfileVideo, 'views' | 'publishedRaw'>): string =>
  `${formatCount(video.views)} views · ${video.publishedRaw}`;

/** A video's score as its badge reads; null when it has none. */
export const profileScore = (video: Pick<ProfileVideo, 'score'>): string | null =>
  video.score === null ? null : formatScore(video.score);
