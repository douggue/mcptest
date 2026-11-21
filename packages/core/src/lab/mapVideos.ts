import type { FormulaVideo } from '../formulas/formulas';
import { buildVideoReport } from '../report';
import type { ChannelRepo, MapRepo, StoredVideo, VideoRepo } from '../repos/types';

/**
 * The videos of one channel's own map: what the idea lab, the title formulas
 * and the hook library may rest on. A store holds several looked-up channels
 * in different niches; everything here is read for one centre channel and
 * never reaches past the channels on that channel's latest map.
 */

export interface MapVideoDeps {
  readonly maps: Pick<MapRepo, 'latestForCenter'>;
  readonly videos: Pick<VideoRepo, 'listByChannel'> & {
    /** One stored video by its id; null when no crawl has read it. */
    findById(videoId: string): StoredVideo | null;
  };
  readonly channels: Pick<ChannelRepo, 'findById'>;
}

/** The centre and the channels on its latest map; null when it has no map. */
export function mapChannelIds(
  maps: MapVideoDeps['maps'],
  centerChannelId: string,
): ReadonlySet<string> | null {
  const map = maps.latestForCenter(centerChannelId);
  return map ? new Set([centerChannelId, ...map.members.map((member) => member.channelId)]) : null;
}

/** A video the owner picked, as far as the page and a tool name it. */
export interface PickedVideo {
  readonly videoId: string;
  readonly title: string;
  readonly channelId: string;
  readonly channelTitle: string;
}

export type Picked = { readonly videos: readonly PickedVideo[] } | { readonly problem: string };

export const NO_MAP = 'No map has been made for this channel yet.';

/**
 * The picked videos, each checked to be a stored video of a channel on the
 * centre channel's latest map, or the reason one is not.
 */
export function pickedVideos(
  deps: MapVideoDeps,
  centerChannelId: string,
  videoIds: readonly string[],
): Picked {
  const onMap = mapChannelIds(deps.maps, centerChannelId);
  if (onMap === null) return { problem: NO_MAP };
  const found = videoIds.map((id) => {
    const video = deps.videos.findById(id);
    return video && onMap.has(video.channelId) ? video : id;
  });
  const missing = found.find((video): video is string => typeof video === 'string');
  if (missing !== undefined) {
    return {
      problem: `The video ${missing} is not a stored video of a channel on this channel’s map.`,
    };
  }
  const stored = found.filter((video): video is StoredVideo => typeof video !== 'string');
  return {
    videos: stored.map((video) => ({
      videoId: video.id,
      title: video.title,
      channelId: video.channelId,
      channelTitle: deps.channels.findById(video.channelId)?.title ?? '',
    })),
  };
}

/** A video an AI's answer names, as the page shows it beside the point it was named for. */
export interface NamedVideo extends PickedVideo {
  readonly views: number;
}

/**
 * The videos an answer names that are stored videos of this channel's map,
 * each once, in the order named. An id that is not stored, or is a video of
 * a channel off the map, is dropped: a made-up or stray id is never shown.
 * `alsoOf` adds the videos of one more stored channel, for an answer about a
 * channel that was studied without being on the map.
 */
export function videosNamed(
  deps: MapVideoDeps,
  centerChannelId: string,
  videoIds: readonly string[],
  alsoOf: string | null = null,
): readonly NamedVideo[] {
  const onMap = mapChannelIds(deps.maps, centerChannelId);
  const allowed = new Set([
    ...(onMap ?? []),
    ...(alsoOf && deps.channels.findById(alsoOf) ? [alsoOf] : []),
  ]);
  return [...new Set(videoIds)].flatMap((id) => {
    const video = deps.videos.findById(id);
    if (!video || !allowed.has(video.channelId)) return [];
    return [
      {
        videoId: video.id,
        title: video.title,
        channelId: video.channelId,
        channelTitle: deps.channels.findById(video.channelId)?.title ?? '',
        views: video.views,
      },
    ];
  });
}

/**
 * Every stored video of the channels on a map that was published in the last
 * `windowDays`, by id, with its views and its score from the store. Null when
 * the channel has no map.
 */
export function videosOnMap(
  deps: MapVideoDeps,
  centerChannelId: string,
  now: Date,
  windowDays: number,
): ReadonlyMap<string, FormulaVideo> | null {
  const onMap = mapChannelIds(deps.maps, centerChannelId);
  if (onMap === null) return null;
  const inside = [...onMap].flatMap((channelId) => {
    const channelTitle = deps.channels.findById(channelId)?.title ?? '';
    return buildVideoReport(deps.videos.listByChannel(channelId), now)
      .filter((row) => row.ageDays <= windowDays)
      .map((row): FormulaVideo => ({
        videoId: row.id,
        title: row.title,
        channelId,
        channelTitle,
        views: row.views,
        score: row.score,
        ageDays: row.ageDays,
      }));
  });
  return new Map(inside.map((video) => [video.videoId, video]));
}
