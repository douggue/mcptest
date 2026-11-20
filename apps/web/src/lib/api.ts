import type { CrawlProgress, MapSnapshot } from '@jgtube/core';

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

    /** Starts a crawl and returns the id of the job to poll. */
    async startCrawl(channel: string, depth: number): Promise<string> {
      const envelope = await call('/api/maps', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ channel, depth }),
      });
      return unwrap<{ jobId: string }>(envelope).jobId;
    },

    async job(id: string): Promise<JobState> {
      return unwrap<JobState>(await call(`/api/jobs/${encodeURIComponent(id)}`));
    },
  };
}

export type Api = ReturnType<typeof createApi>;
