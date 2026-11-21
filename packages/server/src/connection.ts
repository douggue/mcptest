import {
  InnertubeSource,
  RateLimiter,
  type Config,
  type VideoPlayerSource,
  type YouTubeSource,
} from '@jgtube/core';

/**
 * A connection to YouTube that may also be able to answer for a video's
 * files, which the built-in video download works from. The real connection
 * can; a stand-in in a test need not.
 */
export type PlayerSource = YouTubeSource & Partial<VideoPlayerSource>;

const NO_PLAYER = 'This connection to YouTube cannot fetch a video file';

const REQUEST_TIMEOUT_MS = 30_000;

/** The real connection to YouTube's pages, paced so it stays gentle. */
export function youtubeSource(config: Config): Promise<YouTubeSource> {
  return InnertubeSource.create({
    region: config.region,
    limiter: new RateLimiter({
      concurrency: 2,
      minDelayMs: 300,
      maxDelayMs: 600,
      maxRetries: 3,
      baseBackoffMs: 2000,
      taskTimeoutMs: REQUEST_TIMEOUT_MS,
    }),
  });
}

/**
 * Makes a value on first use and keeps it. An attempt that fails is forgotten,
 * so the next use tries again: one bad start (no network, a passing error)
 * must not be remembered until the program is restarted.
 */
export function onceUntilItWorks<T>(make: () => Promise<T>): () => Promise<T> {
  let kept: Promise<T> | null = null;
  return () => {
    if (kept !== null) return kept;
    const attempt = Promise.resolve().then(make);
    kept = attempt;
    attempt.catch(() => {
      if (kept === attempt) kept = null;
    });
    return attempt;
  };
}

export const NOT_READING = 'Jgtube is closing, so nothing more is read from YouTube.';

/**
 * A source that asks YouTube for nothing more once `isStopped` says so. Work
 * under way then finishes the request it is on, finds every further one
 * refused, and winds down by its own rules for failures in a row.
 */
export function stopWhen(source: PlayerSource, isStopped: () => boolean): PlayerSource {
  const check = (): void => {
    if (isStopped()) throw new Error(NOT_READING);
  };
  const { fetchPlayer } = source;
  return {
    ...(fetchPlayer === undefined
      ? {}
      : {
          fetchPlayer: async (videoId: string) => {
            check();
            return fetchPlayer.call(source, videoId);
          },
        }),
    resolveChannelId: async (handle) => {
      check();
      return source.resolveChannelId(handle);
    },
    fetchChannel: async (channelId, maxVideos) => {
      check();
      return source.fetchChannel(channelId, maxVideos);
    },
    getSidebar: async (videoId) => {
      check();
      return source.getSidebar(videoId);
    },
    fetchVideoPage: async (videoId, options) => {
      check();
      return source.fetchVideoPage(videoId, options);
    },
  };
}

/**
 * A source that connects on first use. Work that finds nothing to read then
 * makes no request at all, which matters to a timer that fires every few hours.
 */
export function connectOnUse(
  connect: () => Promise<PlayerSource>,
): YouTubeSource & VideoPlayerSource {
  return {
    fetchPlayer: async (videoId) => {
      const source = await connect();
      if (source.fetchPlayer === undefined) throw new Error(NO_PLAYER);
      return source.fetchPlayer(videoId);
    },
    resolveChannelId: async (handle) => (await connect()).resolveChannelId(handle),
    fetchChannel: async (channelId, maxVideos) =>
      (await connect()).fetchChannel(channelId, maxVideos),
    getSidebar: async (videoId) => (await connect()).getSidebar(videoId),
    fetchVideoPage: async (videoId, options) => (await connect()).fetchVideoPage(videoId, options),
  };
}
