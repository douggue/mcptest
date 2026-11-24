/**
 * Videos from a signed-out search results page, as the YouTube library
 * returns them: only the video and the channel behind it are read; anything
 * else in the results (channels, playlists, shelves) is left out.
 */
import { at, isRecord } from './mappers';
import { CHANNEL_ID_PATTERN, VIDEO_ID_PATTERN } from './parse';

/** A video a search found, with the channel that made it. */
export interface FoundVideo {
  readonly videoId: string;
  readonly channelId: string;
}

/** A source that can search YouTube for videos, one page of results per call. */
export interface VideoSearchSource {
  searchVideos(query: string): Promise<readonly FoundVideo[]>;
}

const asString = (value: unknown): string | null => (typeof value === 'string' ? value : null);

function fromVideo(node: Record<string, unknown>): FoundVideo | null {
  const videoId = asString(node['video_id']) ?? asString(node['id']);
  const channelId = asString(at(node, 'author', 'id'));
  if (!videoId || !channelId) return null;
  return VIDEO_ID_PATTERN.test(videoId) && CHANNEL_ID_PATTERN.test(channelId)
    ? { videoId, channelId }
    : null;
}

/** The nodes of a results list, with the contents of any section opened out. */
function flatten(nodes: readonly unknown[]): readonly unknown[] {
  return nodes.flatMap((node) => {
    const contents = isRecord(node) ? node['contents'] : undefined;
    return Array.isArray(contents) ? flatten(contents) : [node];
  });
}

/** The videos of one results page, each once, in the order shown. */
export function mapSearchResults(results: unknown): readonly FoundVideo[] {
  if (!Array.isArray(results)) return [];
  const seen = new Set<string>();
  return flatten(results).flatMap((node) => {
    if (!isRecord(node) || node['type'] !== 'Video') return [];
    const found = fromVideo(node);
    if (!found || seen.has(found.videoId)) return [];
    seen.add(found.videoId);
    return [found];
  });
}
