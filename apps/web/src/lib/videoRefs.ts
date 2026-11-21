import { stripVideoRefs, videoRefIds } from '@jgtube/core/src/video/refs';

/**
 * Videos an AI's answer names as `[video:ID]`, turned into what the page
 * shows: the point's words, and beside them the real thumbnails of the
 * named videos. Only a video the server says is stored for the map on
 * screen is shown; any other id, made up or stray, is dropped.
 */

/** A stored video an answer names, as the server gives it. */
export interface NamedVideo {
  readonly videoId: string;
  readonly title: string;
  readonly channelId: string;
  readonly channelTitle: string;
  readonly views: number;
}

/** The most ids one lookup takes; the server refuses more. */
export const MAX_NAMED_IDS = 80;

/** One point of an answer: its words, and the stored videos it rests on. */
export interface NamedPoint {
  readonly text: string;
  readonly videos: readonly NamedVideo[];
}

export type VideoIndex = ReadonlyMap<string, NamedVideo>;

/** The stored videos by id, for looking up what a point names. */
export const videoIndex = (videos: readonly NamedVideo[]): VideoIndex =>
  new Map(videos.map((video) => [video.videoId, video]));

/** The ids an answer names, each once, in order, at most as many as one lookup takes. */
export const namedIds = (text: string): readonly string[] =>
  videoRefIds(text).slice(0, MAX_NAMED_IDS);

/** A text without its markers, for copying or reading aloud. */
export const withoutRefs = (text: string): string => stripVideoRefs(text).trim();

/** A point's words, and the stored videos it names, each once, in the order named. */
export function pointOf(text: string, known: VideoIndex): NamedPoint {
  const videos = videoRefIds(text).flatMap((id) => {
    const video = known.get(id);
    return video ? [video] : [];
  });
  return { text: withoutRefs(text), videos };
}
