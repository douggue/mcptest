import type {
  BrandRepo,
  ChannelRepo,
  StoredChannel,
  StoredVideo,
  Transact,
  VideoRepo,
} from './repos/types';
import { parseChannelRef } from './sources/parse';
import type { ChannelRef, StorableVideo, VideoItem, YouTubeSource } from './sources/types';

export const DEFAULT_MAX_VIDEOS = 100;
export const DEFAULT_FRESHNESS_MS = 24 * 60 * 60 * 1000;

export interface IngestDeps {
  readonly source: YouTubeSource;
  readonly channels: ChannelRepo;
  readonly videos: VideoRepo;
  /** Wraps the channel and video writes so a failure stores neither. */
  readonly transact: Transact;
  readonly now: () => Date;
  /**
   * Where a channel's logo, cover and bio are kept. They come with the same
   * page, so with this every read of a channel stores them too, at no request.
   */
  readonly brands?: BrandRepo;
}

export interface IngestOptions {
  readonly maxVideos?: number;
  /** A stored copy younger than this is returned without any request. */
  readonly freshnessMs?: number;
  /** Fetch again even if the stored copy is fresh. */
  readonly refresh?: boolean;
}

export interface IngestResult {
  readonly channel: StoredChannel;
  readonly videos: readonly StoredVideo[];
  readonly fromCache: boolean;
}

function isStorable(video: VideoItem): video is StorableVideo {
  return video.views !== null && video.published !== null;
}

function findKnown(channels: ChannelRepo, ref: ChannelRef): StoredChannel | null {
  return ref.kind === 'id' ? channels.findById(ref.id) : channels.findByHandle(ref.handle);
}

/** A stored id is reused to save a request; a refresh passes null so a reassigned handle is noticed. */
async function resolveId(
  deps: IngestDeps,
  ref: ChannelRef,
  known: StoredChannel | null,
): Promise<string> {
  if (ref.kind === 'id') return ref.id;
  return known?.id ?? deps.source.resolveChannelId(ref.handle);
}

/**
 * Reads a channel and its long-form videos into the store.
 *
 * `input` is a handle, a channel id or a youtube.com URL. A fresh stored copy is
 * returned as-is; otherwise the channel is fetched, stored, and a view-count
 * snapshot is recorded for every video.
 */
export async function ingestChannel(
  deps: IngestDeps,
  input: string,
  options: IngestOptions = {},
): Promise<IngestResult> {
  const ref = parseChannelRef(input);
  const now = deps.now();
  const freshnessMs = options.freshnessMs ?? DEFAULT_FRESHNESS_MS;
  const known = findKnown(deps.channels, ref);

  if (known && !options.refresh && now.getTime() - known.fetchedAt.getTime() < freshnessMs) {
    return { channel: known, videos: deps.videos.listByChannel(known.id), fromCache: true };
  }

  const channelId = await resolveId(deps, ref, options.refresh ? null : known);
  const snapshot = await deps.source.fetchChannel(
    channelId,
    options.maxVideos ?? DEFAULT_MAX_VIDEOS,
  );
  const storable = snapshot.videos.filter(isStorable);
  if (snapshot.videos.length > 0 && storable.length === 0) {
    // Storing this would mark the channel fresh and hide the problem for a day.
    throw new Error(
      `Read ${snapshot.videos.length} videos for channel ${channelId} but none had readable views and dates; nothing was stored`,
    );
  }
  const channel = {
    ...snapshot.channel,
    handle: snapshot.channel.handle ?? (ref.kind === 'handle' ? ref.handle : null),
  };

  deps.transact(() => {
    deps.channels.upsert(channel, now);
    deps.videos.upsertMany(storable, now);
    if (snapshot.brand) deps.brands?.save(channel.id, snapshot.brand, now);
  });

  return {
    channel: { ...channel, fetchedAt: now },
    videos: deps.videos.listByChannel(channel.id),
    fromCache: false,
  };
}
