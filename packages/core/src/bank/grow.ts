/**
 * "Find more outliers": the owner's press grows the bank. One search on a
 * keyword or topic, then the channels behind the videos it found are read
 * into the store through the usual ingest, where the bank scores them like
 * every other video. Nothing here rotates, switches or retries addresses:
 * it reads through the same paced connection the rest of Jgtube uses, and
 * a daily cap kept in the store bounds what it may spend.
 */
import { ingestChannel, type IngestDeps } from '../ingest';
import type { FindRepo } from '../repos/sqliteFindRepo';
import type { FoundVideo } from '../sources/searchResults';
import {
  API_SEARCH_UNITS,
  BANK_FIND_MAX_CHANNELS,
  PAGE_REQUESTS_PER_CHANNEL,
  SEARCH_REQUESTS,
  BANK_FIND_WINDOW_HOURS,
  findAllowance,
  planFind,
  planSpend,
  type FindAllowance,
  type FindPlan,
  type FindVia,
} from './cost';

const HOUR_MS = 60 * 60 * 1000;
const MAX_QUERY_LENGTH = 200;
const FAILURES_KEPT = 5;

export class FindCapError extends Error {
  constructor(
    readonly allowance: FindAllowance,
    readonly plan: FindPlan,
  ) {
    const unit = allowance.via === 'api' ? 'API units' : 'page requests';
    super(
      `This would take up to ${planSpend(plan)} ${unit} and ${allowance.left} of today's ${allowance.cap} are left. Read fewer channels, or try again later.`,
    );
    this.name = 'FindCapError';
  }
}

export interface FindDeps extends IngestDeps {
  readonly finds: FindRepo;
  readonly via: FindVia;
  /** One page of results for the words. */
  readonly search: (query: string) => Promise<readonly FoundVideo[]>;
  /** The requests made to the API so far, counted exactly; absent when reading pages. */
  readonly apiRequestsMade?: () => number;
}

export interface FindRequest {
  readonly query: string;
  readonly maxChannels: number;
}

export interface FindProgress {
  readonly text: string;
  readonly done?: number;
  readonly total?: number;
}

export interface FindOutcome {
  readonly query: string;
  readonly via: FindVia;
  readonly videosFound: number;
  readonly channelsFound: number;
  /** Channels read from YouTube by this run. */
  readonly channelsRead: number;
  /** Channels the store already held from today, so nothing was read. */
  readonly alreadyKnown: number;
  readonly failed: number;
  readonly problems: readonly string[];
  /** Page requests (an upper bound per channel read) or API requests (counted). */
  readonly requests: number;
  readonly apiUnits: number;
}

/** What is left of the day's cap now. */
export function allowanceNow(finds: FindRepo, via: FindVia, now: Date): FindAllowance {
  const since = new Date(now.getTime() - BANK_FIND_WINDOW_HOURS * HOUR_MS);
  return findAllowance(via, finds.spentSince(via, since));
}

/** Channel ids behind the videos: most videos found first, then in the order found. */
function rankChannels(found: readonly FoundVideo[]): readonly string[] {
  const counts = new Map<string, number>();
  for (const video of found) counts.set(video.channelId, (counts.get(video.channelId) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]).map(([channelId]) => channelId);
}

function checkRequest({ query, maxChannels }: FindRequest): string {
  const text = query.trim();
  if (text === '' || text.length > MAX_QUERY_LENGTH) {
    throw new Error(`Give a keyword or topic of 1 to ${MAX_QUERY_LENGTH} characters`);
  }
  if (!Number.isInteger(maxChannels) || maxChannels < 1 || maxChannels > BANK_FIND_MAX_CHANNELS) {
    throw new RangeError(`Read 1 to ${BANK_FIND_MAX_CHANNELS} channels`);
  }
  return text;
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

interface Reads {
  readonly read: number;
  readonly known: number;
  readonly problems: readonly string[];
  readonly failed: number;
}

async function readChannels(
  deps: FindDeps,
  channelIds: readonly string[],
  onProgress: (progress: FindProgress) => void,
): Promise<Reads> {
  let reads: Reads = { read: 0, known: 0, problems: [], failed: 0 };
  for (const [index, channelId] of channelIds.entries()) {
    onProgress({
      text: `Reading channel ${index + 1} of ${channelIds.length}`,
      done: index,
      total: channelIds.length,
    });
    try {
      const { fromCache } = await ingestChannel(deps, channelId);
      reads = fromCache ? { ...reads, known: reads.known + 1 } : { ...reads, read: reads.read + 1 };
    } catch (error) {
      reads = {
        ...reads,
        failed: reads.failed + 1,
        problems: [...reads.problems, messageOf(error)].slice(0, FAILURES_KEPT),
      };
    }
  }
  return reads;
}

/** Searches, reads the channels found into the store, and records what it spent. */
export async function findMoreOutliers(
  deps: FindDeps,
  request: FindRequest,
  onProgress: (progress: FindProgress) => void = () => {},
): Promise<FindOutcome> {
  const query = checkRequest(request);
  const startedAt = deps.now();
  const plan = planFind(deps.via, request.maxChannels);
  const allowance = allowanceNow(deps.finds, deps.via, startedAt);
  if (planSpend(plan) > allowance.left) throw new FindCapError(allowance, plan);

  onProgress({ text: `Searching for “${query}”` });
  const found = await deps.search(query);
  const ranked = rankChannels(found);
  const reads = await readChannels(deps, ranked.slice(0, request.maxChannels), onProgress);
  const apiRequests = deps.apiRequestsMade?.() ?? 0;
  const spent =
    deps.via === 'api'
      ? { requests: SEARCH_REQUESTS + apiRequests, apiUnits: API_SEARCH_UNITS + apiRequests }
      : {
          requests: SEARCH_REQUESTS + (reads.read + reads.failed) * PAGE_REQUESTS_PER_CHANNEL,
          apiUnits: 0,
        };
  deps.finds.record({
    query,
    via: deps.via,
    ...spent,
    channelsRead: reads.read,
    startedAt,
    finishedAt: deps.now(),
  });
  return {
    query,
    via: deps.via,
    videosFound: found.length,
    channelsFound: ranked.length,
    channelsRead: reads.read,
    alreadyKnown: reads.known,
    failed: reads.failed,
    problems: reads.problems,
    ...spent,
  };
}
