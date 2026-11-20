import type {
  CompetitorStatus,
  CrawlProgress,
  MapSnapshot,
  NicheList,
  SameTopicList,
  ThumbnailBoard,
} from '@jgtube/core';

/** The niche list, plus whether keyword search can run (it needs a YouTube API key). */
export interface NichesReply extends NicheList {
  readonly canDiscover: boolean;
}

/** What one keyword search found, as counts. */
export interface SearchSummary {
  readonly keyword: string;
  readonly videosFound: number;
  readonly channelsFound: number;
  readonly added: number;
  readonly alreadyKnown: number;
  readonly failed: number;
}

export interface JobState {
  readonly id: string;
  readonly status: 'running' | 'done' | 'failed';
  readonly progress: CrawlProgress | null;
  readonly result: {
    readonly centerChannelId: string;
    readonly warnings: readonly string[];
  } | null;
  readonly error: string | null;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

interface Envelope {
  readonly success: boolean;
  readonly data: unknown;
  readonly error: string | null;
}

function isEnvelope(value: unknown): value is Envelope {
  return typeof value === 'object' && value !== null && 'success' in value && 'data' in value;
}

async function readEnvelope(response: Response): Promise<Envelope> {
  try {
    const body: unknown = await response.json();
    if (isEnvelope(body)) return body;
  } catch {
    // Fall through to the shared message below.
  }
  throw new ApiError('The Jgtube server gave an unexpected reply', response.status);
}

/** The local server's API. `fetcher` is injectable so it can be tested without a network. */
export function createApi(fetcher: Fetch = (input, init) => fetch(input, init)) {
  const call = async (path: string, init?: RequestInit): Promise<Envelope & { status: number }> => {
    const response = await fetcher(path, init);
    return { ...(await readEnvelope(response)), status: response.status };
  };
  const unwrap = <T>(envelope: Envelope & { status: number }): T => {
    if (!envelope.success) {
      throw new ApiError(envelope.error ?? 'The request failed', envelope.status);
    }
    return envelope.data as T;
  };

  return {
    /** The stored map around a channel, or null when none has been made. */
    async latestMap(channel: string): Promise<MapSnapshot | null> {
      const envelope = await call(`/api/maps/latest?channel=${encodeURIComponent(channel)}`);
      if (envelope.status === 404) return null;
      return unwrap<MapSnapshot>(envelope);
    },

    /** The thumbnails that worked around a channel, or null when it has no map yet. */
    async thumbnailBoard(channel: string): Promise<ThumbnailBoard | null> {
      const envelope = await call(
        `/api/maps/latest/thumbnails?channel=${encodeURIComponent(channel)}`,
      );
      if (envelope.status === 404) return null;
      return unwrap<ThumbnailBoard>(envelope);
    },

    /** The channels left out of a channel's map on wording alone, or null when it has no map yet. */
    async sameTopic(channel: string): Promise<SameTopicList | null> {
      const envelope = await call(
        `/api/maps/latest/same-topic?channel=${encodeURIComponent(channel)}`,
      );
      if (envelope.status === 404) return null;
      return unwrap<SameTopicList>(envelope);
    },

    /** Starts a new map. `model` is a channel the owner wants to be like, if any. */
    async startCrawl(
      channel: string,
      depth: number,
      model = '',
      maxChannels?: number,
    ): Promise<string> {
      const wanted = model.trim();
      const envelope = await call('/api/maps', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          channel,
          depth,
          ...(wanted ? { model: wanted } : {}),
          ...(maxChannels ? { maxChannels } : {}),
        }),
      });
      return unwrap<{ jobId: string }>(envelope).jobId;
    },

    /** Keeps a channel as a competitor, removes it, or leaves it to the filter again. */
    async setCompetitorStatus(
      center: string,
      channel: string,
      status: CompetitorStatus,
    ): Promise<void> {
      unwrap<unknown>(
        await call('/api/competitors', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ center, channel, status }),
        }),
      );
    },

    /** New or small channels across everything stored with a video that took off, and the watched ones. */
    async niches(): Promise<NichesReply> {
      return unwrap<NichesReply>(await call('/api/niches'));
    },

    /** Searches YouTube for recent videos on a subject and reads the channels behind them. */
    async discoverNiches(keyword: string): Promise<SearchSummary> {
      return unwrap<SearchSummary>(
        await call('/api/niches/discover', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ keyword }),
        }),
      );
    },

    /** Marks a channel as a niche to watch, or unmarks it. */
    async setNicheWatched(channel: string, watched: boolean): Promise<void> {
      unwrap<unknown>(
        await call('/api/niches/watch', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ channel, watched }),
        }),
      );
    },

    async job(id: string): Promise<JobState> {
      return unwrap<JobState>(await call(`/api/jobs/${encodeURIComponent(id)}`));
    },
  };
}

export type Api = ReturnType<typeof createApi>;
