import {
  describeVideos,
  downloadsRoot,
  fetchVideoDetails,
  parseChannelRef,
  readChannelBrand,
  readFileFrames,
  readTranscript,
  readVideoDetails,
  readVideoFrames,
  saveChannelThumbnails,
  saveChannelTranscripts,
  type ApiVideoDetails,
  type BrandRepo,
  type BreakdownRepo,
  type ChannelRepo,
  type Config,
  type FetchImage,
  type SqliteVideoPageRepo,
  type SqliteVideoRepo,
  type StoredChannel,
  type transactionRunner,
  type VideoFrames,
  type VideoPageDeps,
  type VideoStudyRepo,
  type YouTubeSource,
} from '@jgtube/core';
import type { DownloadsEngine } from './downloadTypes';

/** What the downloaders are built from: the store, the settings and a way to YouTube. */
export interface DownloadWiring {
  readonly config: Config;
  readonly now: () => Date;
  readonly repos: {
    readonly channels: ChannelRepo;
    readonly videos: SqliteVideoRepo;
    readonly brands: BrandRepo;
    readonly pages: SqliteVideoPageRepo;
    readonly studies: VideoStudyRepo;
    readonly breakdowns: BreakdownRepo;
  };
  readonly transact: ReturnType<typeof transactionRunner>;
  /** A source that connects on first use, so a read the store can answer makes no request. */
  readonly lazySource: YouTubeSource;
  /** Tracks work under way, so shutting down can wait for it. */
  readonly run: <T>(work: () => Promise<T>) => Promise<T>;
  /** Replaces the network for pictures; used by tests. */
  readonly fetchImage?: FetchImage | undefined;
  /** Replaces the official API's video details; used by tests. Only called when a key is set. */
  readonly fetchVideoDetails?:
    ((videoIds: readonly string[]) => Promise<readonly ApiVideoDetails[]>) | undefined;
}

/**
 * The downloaders and the readers Claude's tools use: thumbnails to disk,
 * transcripts, frames, branding and video details. Each reads the store
 * first and asks YouTube only for what is missing, through the rate limiter
 * the rest of the engine shares. They make a request or two, so they do not
 * take the lease that a crawl or a refresh holds.
 */
export function downloads(wiring: DownloadWiring): DownloadsEngine {
  const { config, now, repos, lazySource, run } = wiring;
  const apiKey = config.youtubeApiKey;
  const fetchDetails =
    apiKey === undefined
      ? undefined
      : (wiring.fetchVideoDetails ??
        ((ids: readonly string[]) => fetchVideoDetails(ids, { apiKey })));
  const pageDeps: VideoPageDeps = {
    source: lazySource,
    transcripts: repos.pages,
    details: repos.pages,
    now,
    ...(fetchDetails ? { fetchDetails } : {}),
  };
  const imageDeps = wiring.fetchImage ? { fetchImage: wiring.fetchImage } : {};
  const storedChannel = (channel: string): StoredChannel | null => {
    const ref = parseChannelRef(channel);
    return ref.kind === 'id'
      ? repos.channels.findById(ref.id)
      : repos.channels.findByHandle(ref.handle);
  };
  /** Frames cut from the video's own file, when Jgtube has cut them and has a folder to look in. */
  const fileFrames = async (
    videoId: string,
    sheets: number,
    from: number | undefined,
  ): Promise<VideoFrames | null> => {
    let root: string;
    try {
      root = downloadsRoot(config);
    } catch {
      // A store that is only in memory has no downloads folder, so nothing was ever cut.
      return null;
    }
    return readFileFrames(root, videoId, sheets, from);
  };

  return {
    saveThumbnails(channel) {
      const stored = storedChannel(channel);
      if (!stored) return Promise.resolve(null);
      return run(() =>
        saveChannelThumbnails(
          { channels: repos.channels, videos: repos.videos, now, ...imageDeps },
          stored.id,
          downloadsRoot(config),
        ),
      );
    },

    saveTranscripts(channel) {
      const stored = storedChannel(channel);
      if (!stored) return Promise.resolve(null);
      return run(() =>
        saveChannelTranscripts(
          { ...pageDeps, channels: repos.channels, videos: repos.videos },
          stored.id,
          downloadsRoot(config),
        ),
      );
    },

    readTranscript: (videoId) => run(() => readTranscript(pageDeps, videoId)),

    readVideoFrames: (videoId, sheets, from) =>
      run(
        async () =>
          (await fileFrames(videoId, sheets, from)) ??
          readVideoFrames({ ...pageDeps, ...imageDeps }, videoId, sheets, from),
      ),

    findVideoStudy: (videoId, kind) => repos.studies.find(videoId, kind),

    findVideoSeconds: (videoId) =>
      repos.videos.findById(videoId)?.durationSeconds ??
      repos.pages.findDetails(videoId)?.durationSeconds ??
      null,

    findBreakdownPart(channel, part) {
      const stored = storedChannel(channel);
      return stored ? repos.breakdowns.find(stored.id, part) : null;
    },

    readChannelBrand: (channel) =>
      run(() =>
        readChannelBrand(
          {
            source: lazySource,
            channels: repos.channels,
            videos: repos.videos,
            brands: repos.brands,
            transact: wiring.transact,
            now,
          },
          channel,
        ),
      ),

    readVideoDetails: (videoIds) =>
      run(async () => {
        const read = await readVideoDetails(pageDeps, videoIds);
        return {
          videos: describeVideos(repos.videos, read.details, now()),
          problems: read.problems,
          apiProblem: read.apiProblem,
        };
      }),
  };
}
