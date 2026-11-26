import { NICHE_MIN_LATIN_SHARE, latinShare } from '../niches/script';
import type { StoredVideo } from '../repos/types';
import { PEER_MIN_TITLE_MATCH } from './peers';
import {
  loadMapSnapshot,
  type MapSnapshot,
  type SnapshotChannel,
  type SnapshotDeps,
} from './snapshot';
import type { Breakout } from './view';

/**
 * "Same topic, different wording?": the channels on a map that fit the centre
 * on size, publishing rate and video length and were left out on title wording
 * alone. Title matching compares words, so a channel covering the same subject
 * in its own words lands here. Whether it is a competitor is a judgement about
 * meaning, which the owner (or a model reading these titles) makes; this list
 * only puts the evidence in one place.
 *
 * Nothing here is frozen: it is worked out from the map as the owner sees it
 * and the videos in the store, each time it is asked for.
 */

/** Newest titles shown per channel: enough to see what it makes, few enough to scan. */
export const SAME_TOPIC_TITLES_SHOWN = 4;
/** Newest titles per channel that the alphabet check reads, as on the niche list. */
const TITLES_CHECKED = 30;

export interface SameTopicVideo {
  readonly videoId: string;
  readonly title: string;
  readonly views: number;
  /** The relative date as YouTube gave it, such as "2w ago". */
  readonly publishedRaw: string;
}

export interface SameTopicChannel {
  readonly id: string;
  readonly title: string;
  readonly handle: string | null;
  readonly subscribers: number | null;
  /** Title match to the centre (or the model channel), 0 to 1; below `minTitleMatch`. */
  readonly titleMatch: number;
  /** Views on videos uploaded in the last 30 days. */
  readonly recentViews: number;
  readonly recentUploads: number;
  readonly breakout: Breakout | null;
  /** Its newest stored videos, newest first. */
  readonly recentTitles: readonly SameTopicVideo[];
}

/** A channel left out on titles that the owner has since kept as a competitor. */
export interface SameTopicKept {
  readonly id: string;
  readonly title: string;
}

/** Plain values, ready to serialise. */
export interface SameTopicList {
  readonly mapId: number;
  readonly centerId: string;
  /** The title match a channel needs to count as a look-alike without the owner's say. */
  readonly minTitleMatch: number;
  /** Left out on titles alone and not yet decided by the owner; strongest title match first. */
  readonly channels: readonly SameTopicChannel[];
  /** Left out on titles and kept by the owner, so the choice can be undone here. */
  readonly kept: readonly SameTopicKept[];
  /** Channels left out of `channels` because they are written in another alphabet than the centre. */
  readonly otherAlphabet: number;
}

type VideosOf = (channelId: string) => readonly StoredVideo[];

const isLatin = (videos: readonly StoredVideo[]): boolean =>
  latinShare(videos.slice(0, TITLES_CHECKED).map((video) => video.title)) >= NICHE_MIN_LATIN_SHARE;

function describe(channel: SnapshotChannel, videos: readonly StoredVideo[]): SameTopicChannel {
  return {
    id: channel.id,
    title: channel.title,
    handle: channel.handle,
    subscribers: channel.subscribers,
    titleMatch: channel.relevance,
    recentViews: channel.recentViews,
    recentUploads: channel.recentUploads,
    breakout: channel.breakout,
    recentTitles: videos.slice(0, SAME_TOPIC_TITLES_SHOWN).map((video) => ({
      videoId: video.id,
      title: video.title,
      views: video.views,
      publishedRaw: video.published.raw,
    })),
  };
}

/**
 * Builds the list from a map as the owner sees it. `videosOf` gives a channel's
 * stored videos, newest first.
 *
 * A channel in another alphabet than the centre is left out and counted: its
 * titles fail to match because of the language, not the wording, and the owner
 * cannot weigh them. With no centre titles in Latin letters nobody is left out.
 */
export function buildSameTopicList(snapshot: MapSnapshot, videosOf: VideosOf): SameTopicList {
  const onTitles = snapshot.channels.filter((channel) => channel.outsideReason === 'titles');
  const undecided = onTitles
    .filter((channel) => !channel.kept && !channel.removed)
    .map((channel) => ({ channel, videos: videosOf(channel.id) }));
  const centerIsLatin = isLatin(videosOf(snapshot.center.id));
  // A channel with no stored titles cannot be shown to be in another alphabet.
  const readable = undecided.filter(
    ({ videos }) => !centerIsLatin || videos.length === 0 || isLatin(videos),
  );
  return {
    mapId: snapshot.mapId,
    centerId: snapshot.center.id,
    minTitleMatch: PEER_MIN_TITLE_MATCH,
    channels: readable
      .map(({ channel, videos }) => describe(channel, videos))
      .sort((a, b) => b.titleMatch - a.titleMatch || a.title.localeCompare(b.title)),
    kept: onTitles
      .filter((channel) => channel.kept)
      .map((channel) => ({ id: channel.id, title: channel.title })),
    otherAlphabet: undecided.length - readable.length,
  };
}

/** The list for the latest map around a channel, or null when none has been made. */
export function loadSameTopicList(
  deps: SnapshotDeps,
  centerChannelId: string,
  now: Date,
  /** The map, when the caller has already read it; left out, it is read here. */
  read: MapSnapshot | null = loadMapSnapshot(deps, centerChannelId, now),
): SameTopicList | null {
  const snapshot = read;
  return snapshot
    ? buildSameTopicList(snapshot, (channelId) => deps.videos.listByChannel(channelId))
    : null;
}
