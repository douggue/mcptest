import { InnertubeSource, RateLimiter, type Config, type YouTubeSource } from '@jgtube/core';

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

/**
 * A source that connects on first use. Work that finds nothing to read then
 * makes no request at all, which matters to a timer that fires every few hours.
 */
export function connectOnUse(connect: () => Promise<YouTubeSource>): YouTubeSource {
  return {
    resolveChannelId: async (handle) => (await connect()).resolveChannelId(handle),
    fetchChannel: async (channelId, maxVideos) =>
      (await connect()).fetchChannel(channelId, maxVideos),
    getSidebar: async (videoId) => (await connect()).getSidebar(videoId),
  };
}
