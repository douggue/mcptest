import {
  AUTOMATIC,
  type AnalysisAnswer,
  type AnalysisId,
  type EngineChoice,
  type EngineReport,
} from './analyses';
import type { BreakdownJobState, TranscriptsSaved } from './breakdown';
import type { BreakdownView } from './breakdownParts';
import type {
  CompetitorStatus,
  CrawlProgress,
  MapSnapshot,
  NicheList,
  RefreshProgress,
  RefreshStatus,
  SavedChannel,
  SameTopicList,
  ThumbnailBoard,
  TransferList,
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
  /** Channels whose account date and country were read from the official API afterwards. */
  readonly factsAdded: number;
  /** Why those could not be read; null when they were. */
  readonly factsProblem: string | null;
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

/** When the stored channels were last read again, and whether a refresh is running now. */
export interface RefreshReply extends RefreshStatus {
  /** Hours between scheduled refreshes; null when none is scheduled. */
  readonly everyHours: number | null;
  readonly running: boolean;
  /** The job to poll while a refresh is running. */
  readonly jobId: string | null;
}

/** How one refresh went, as counts. */
export interface RefreshSummary {
  readonly refreshed: number;
  readonly failed: number;
  readonly notAttempted: number;
  readonly stoppedEarly: boolean;
  readonly stillDue: number;
  /** Niche channels whose account date and country were read from the official API. */
  readonly factsAdded: number;
  /** Why those could not be read; null when they were, or when no API key is set. */
  readonly factsProblem: string | null;
}

export interface RefreshJobState {
  readonly id: string;
  readonly status: 'running' | 'done' | 'failed';
  readonly progress: RefreshProgress | null;
  readonly result: RefreshSummary | null;
  readonly error: string | null;
}

/** Where a channel's thumbnails were saved on this computer, and how it went. */
export interface ThumbnailsSaved {
  readonly channel: string;
  /** The folder holding the pictures, as a path on the owner's computer. */
  readonly folder: string;
  readonly indexFile: string;
  /** Pictures now in the folder. */
  readonly total: number;
  readonly saved: number;
  readonly alreadyThere: number;
  readonly failed: number;
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

    /** Every channel a map has been made for, the most recently mapped first. */
    async savedChannels(): Promise<readonly SavedChannel[]> {
      return unwrap<{ channels: readonly SavedChannel[] }>(await call('/api/maps')).channels;
    },

    /** Deletes a saved channel's maps; what was read about the channels stays in the store. */
    async deleteSavedChannel(channelId: string): Promise<void> {
      unwrap<unknown>(
        await call('/api/maps/delete', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ channel: channelId }),
        }),
      );
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

    /**
     * Asks an AI engine for one of the fixed analyses of a channel; resolves
     * with its answer as text, the engine that gave it and the ones passed over.
     * With a chosen engine, only that one is asked.
     */
    async analyse(
      analysis: AnalysisId,
      channel: string,
      choice: EngineChoice = AUTOMATIC,
    ): Promise<AnalysisAnswer> {
      const { text, engine, skipped } = unwrap<Partial<AnalysisAnswer> & { text: string }>(
        await call('/api/analyses', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            analysis,
            channel,
            ...(choice === AUTOMATIC ? {} : { engine: choice }),
          }),
        }),
      );
      return { text, engine: engine ?? null, skipped: skipped ?? [] };
    },

    /** Which AI engines are installed and signed in on this computer, and the order they are tried in. */
    async engines(): Promise<EngineReport> {
      return unwrap<EngineReport>(await call('/api/engines'));
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

    /**
     * Ideas several channels made, judged as transfer opportunities for the
     * place of the channel on screen (or of the mapped channels, with none).
     */
    async transfers(channel: string | null): Promise<TransferList> {
      const query = channel ? `?channel=${encodeURIComponent(channel)}` : '';
      return unwrap<TransferList>(await call(`/api/transfers${query}`));
    },

    /** Saves an idea as a transfer opportunity, or stops saving it. */
    async setTransferSaved(key: string, saved: boolean): Promise<void> {
      unwrap<unknown>(
        await call('/api/transfers/save', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ key, saved }),
        }),
      );
    },

    /** Saves a channel's winning and ordinary thumbnails as files on this computer. */
    async downloadThumbnails(channel: string): Promise<ThumbnailsSaved> {
      return unwrap<ThumbnailsSaved>(
        await call('/api/thumbnails/download', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ channel }),
        }),
      );
    },

    /** Saves the transcripts of a channel's videos that took off as files on this computer. */
    async downloadTranscripts(channel: string): Promise<TranscriptsSaved> {
      return unwrap<TranscriptsSaved>(
        await call('/api/transcripts/download', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ channel }),
        }),
      );
    },

    /**
     * Starts a breakdown of one channel and returns the id of the job to poll.
     * With a chosen engine, only that one studies the frames and writes; with
     * `fresh`, stored watch notes and frame studies are made again.
     */
    async startBreakdown(
      channel: string,
      choice: EngineChoice = AUTOMATIC,
      fresh = false,
    ): Promise<string> {
      const envelope = await call('/api/breakdowns', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          channel,
          ...(choice === AUTOMATIC ? {} : { engine: choice }),
          ...(fresh ? { fresh: true } : {}),
        }),
      });
      return unwrap<{ jobId: string }>(envelope).jobId;
    },

    /** A channel's stored breakdown, or null when none has been written for it. */
    async storedBreakdown(channel: string): Promise<BreakdownView | null> {
      const envelope = await call(`/api/breakdowns?channel=${encodeURIComponent(channel)}`);
      return unwrap<BreakdownView | null>(envelope);
    },

    async breakdownJob(id: string): Promise<BreakdownJobState> {
      return unwrap<BreakdownJobState>(await call(`/api/jobs/${encodeURIComponent(id)}`));
    },

    async job(id: string): Promise<JobState> {
      return unwrap<JobState>(await call(`/api/jobs/${encodeURIComponent(id)}`));
    },

    /** When the stored channels were last read again, and whether a refresh is running. */
    async refreshStatus(): Promise<RefreshReply> {
      return unwrap<RefreshReply>(await call('/api/refresh'));
    },

    /** Starts reading the stalest stored channels again and returns the id of the job to poll. */
    async startRefresh(): Promise<string> {
      const envelope = await call('/api/refresh', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      return unwrap<{ jobId: string }>(envelope).jobId;
    },

    async refreshJob(id: string): Promise<RefreshJobState> {
      return unwrap<RefreshJobState>(await call(`/api/jobs/${encodeURIComponent(id)}`));
    },
  };
}

export type Api = ReturnType<typeof createApi>;
