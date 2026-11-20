import { ingestChannel, type IngestDeps } from '../ingest';
import type { EdgeRepo, MapMember, MapRepo, RecEdge } from '../repos/types';
import type { SidebarItem } from '../sources/types';
import { buildEdges } from './edges';

export const DEFAULT_DEPTH = 2;
export const MAX_DEPTH = 2;
export const DEFAULT_SAMPLE_SIZE = 10;
export const DEFAULT_TOP_CHANNELS = 15;
export const DEFAULT_MAX_CHANNELS = 150;
export const EDGE_FRESHNESS_MS = 7 * 24 * 60 * 60 * 1000;
/** A reading built from fewer sidebars than this share of the sample is too thin to trust or keep. */
const MIN_SIDEBAR_COVERAGE = 0.7;
/** Work is issued in small batches so a blocked crawl can stop instead of queueing everything. */
const BATCH_SIZE = 4;
/** This many failures in a row means YouTube is refusing us, not that one page is odd. */
const MAX_CONSECUTIVE_FAILURES = 8;
const NOT_ATTEMPTED = 'not attempted';

export interface CrawlDeps extends IngestDeps {
  readonly edges: EdgeRepo;
  readonly maps: MapRepo;
  /** Country the recommendations are read from; stored with every reading. */
  readonly region: string;
}

export interface CrawlProgress {
  readonly stage: 'reading-recommendations' | 'reading-channels' | 'done';
  /** Channels in the map so far, including the centre. */
  readonly channels: number;
  readonly step?: number;
}

export interface CrawlOptions {
  /** How many recommendation hops to follow: 1 or 2. */
  readonly depth?: number;
  /** Newest videos per channel whose sidebars are read. */
  readonly sampleSize?: number;
  /** Recommended channels kept per channel. */
  readonly topChannels?: number;
  /** Upper bound on the whole map, centre included. */
  readonly maxChannels?: number;
  readonly onProgress?: (progress: CrawlProgress) => void;
}

export interface CrawlResult {
  readonly mapId: number;
  readonly centerChannelId: string;
  readonly depth: number;
  readonly members: readonly MapMember[];
  readonly warnings: readonly string[];
}

interface Settings {
  readonly depth: number;
  readonly sampleSize: number;
  readonly topChannels: number;
  readonly maxChannels: number;
}

interface Reading {
  readonly edges: readonly RecEdge[];
  readonly warning: string | null;
}

interface SidebarRead {
  readonly videoId: string;
  readonly items: readonly SidebarItem[] | null;
  readonly error: string | null;
}

interface IngestOutcome {
  readonly channelId: string;
  readonly error: string | null;
}

/** Counts failures in a row across the whole crawl. */
class FailureGuard {
  private consecutive = 0;

  record(succeeded: boolean): void {
    this.consecutive = succeeded ? 0 : this.consecutive + 1;
  }

  get tripped(): boolean {
    return this.consecutive >= MAX_CONSECUTIVE_FAILURES;
  }
}

function assertWholeNumber(name: string, value: number, min: number, max: number): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${name} must be a whole number from ${min} to ${max}`);
  }
}

function resolveSettings(options: CrawlOptions): Settings {
  const settings = {
    depth: options.depth ?? DEFAULT_DEPTH,
    sampleSize: options.sampleSize ?? DEFAULT_SAMPLE_SIZE,
    topChannels: options.topChannels ?? DEFAULT_TOP_CHANNELS,
    maxChannels: options.maxChannels ?? DEFAULT_MAX_CHANNELS,
  };
  assertWholeNumber('depth', settings.depth, 1, MAX_DEPTH);
  assertWholeNumber('sampleSize', settings.sampleSize, 1, 30);
  assertWholeNumber('topChannels', settings.topChannels, 1, 50);
  assertWholeNumber('maxChannels', settings.maxChannels, 1, 1000);
  return settings;
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** Runs `run` over the items a few at a time; once the guard trips, the rest are marked skipped. */
async function inBatches<T, R>(
  items: readonly T[],
  guard: FailureGuard,
  run: (item: T) => Promise<R>,
  skip: (item: T) => R,
): Promise<readonly R[]> {
  let results: readonly R[] = [];
  for (let start = 0; start < items.length; start += BATCH_SIZE) {
    const batch = items.slice(start, start + BATCH_SIZE);
    const done = guard.tripped ? batch.map(skip) : await Promise.all(batch.map(run));
    results = [...results, ...done];
  }
  return results;
}

async function readSidebar(
  deps: CrawlDeps,
  videoId: string,
  guard: FailureGuard,
): Promise<SidebarRead> {
  try {
    const items = await deps.source.getSidebar(videoId);
    guard.record(true);
    return { videoId, items, error: null };
  } catch (error) {
    guard.record(false);
    return { videoId, items: null, error: messageOf(error) };
  }
}

/** A channel's outgoing edges: the stored reading if it is fresh, otherwise a new one. */
async function readEdges(
  deps: CrawlDeps,
  channelId: string,
  settings: Settings,
  guard: FailureGuard,
): Promise<Reading> {
  const now = deps.now();
  const stored = deps.edges.listFrom(channelId);
  const isFresh =
    stored !== null &&
    stored.region === deps.region &&
    now.getTime() - stored.crawledAt.getTime() < EDGE_FRESHNESS_MS;
  if (isFresh) return { edges: stored.edges.slice(0, settings.topChannels), warning: null };

  const sample = deps.videos.listByChannel(channelId).slice(0, settings.sampleSize);
  // Nothing to read. Not stored, so a later crawl looks again once the channel has videos.
  if (sample.length === 0) return { edges: [], warning: null };

  const reads = await inBatches(
    sample.map((video) => video.id),
    guard,
    (videoId) => readSidebar(deps, videoId, guard),
    (videoId): SidebarRead => ({ videoId, items: null, error: NOT_ATTEMPTED }),
  );
  const sidebars = new Map(
    reads.flatMap((read) => (read.items ? [[read.videoId, read.items] as const] : [])),
  );
  const failed = sample.length - sidebars.size;
  const cause = reads.find((read) => read.error !== null)?.error ?? 'unknown error';
  if (sidebars.size / sample.length < MIN_SIDEBAR_COVERAGE) {
    return {
      edges: [],
      warning: `Recommendations for ${channelId} were not used: only ${sidebars.size} of ${sample.length} sidebars could be read (${cause})`,
    };
  }

  const edges = buildEdges(channelId, sidebars, { topChannels: settings.topChannels });
  deps.edges.replaceFrom(channelId, edges, deps.region, now);
  return {
    edges,
    warning:
      failed > 0
        ? `Could not read ${failed} of ${sample.length} sidebars for ${channelId} (${cause})`
        : null,
  };
}

/** New channels reached from this step, strongest recommendation first. */
function rankCandidates(edges: readonly RecEdge[], known: ReadonlySet<string>): readonly string[] {
  const strength = new Map<string, number>();
  for (const edge of edges) {
    if (known.has(edge.toChannelId)) continue;
    strength.set(edge.toChannelId, (strength.get(edge.toChannelId) ?? 0) + edge.share);
  }
  return [...strength]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([channelId]) => channelId);
}

async function ingestNeighbour(
  deps: CrawlDeps,
  channelId: string,
  guard: FailureGuard,
): Promise<IngestOutcome> {
  try {
    await ingestChannel(deps, channelId);
    guard.record(true);
    return { channelId, error: null };
  } catch (error) {
    guard.record(false);
    return { channelId, error: messageOf(error) };
  }
}

function stepWarnings(
  readings: readonly Reading[],
  outcomes: readonly IngestOutcome[],
  leftOut: number,
  step: number,
  settings: Settings,
): readonly string[] {
  const notAttempted = outcomes.filter((outcome) => outcome.error === NOT_ATTEMPTED).length;
  return [
    ...readings.flatMap((reading) => (reading.warning ? [reading.warning] : [])),
    ...(leftOut > 0
      ? [
          `Channel budget of ${settings.maxChannels} reached: ${leftOut} channels at step ${step} were left out`,
        ]
      : []),
    ...outcomes.flatMap((outcome) =>
      outcome.error && outcome.error !== NOT_ATTEMPTED
        ? [`Skipped ${outcome.channelId}: ${outcome.error}`]
        : [],
    ),
    ...(notAttempted > 0
      ? [
          `Stopped early after ${MAX_CONSECUTIVE_FAILURES} failures in a row: ${notAttempted} channels were not read`,
        ]
      : []),
  ];
}

/**
 * Builds the map of channels around one channel by following YouTube's
 * recommendations outwards (see docs/CRAWL.md).
 *
 * Channels at the last step are read but not expanded. Anything already stored
 * and fresh is reused, so repeating a crawl costs few or no requests. A channel
 * that cannot be read is skipped with a warning; its place in the budget is not
 * given to another.
 */
export async function crawlMap(
  deps: CrawlDeps,
  input: string,
  options: CrawlOptions = {},
): Promise<CrawlResult> {
  const settings = resolveSettings(options);
  const report = options.onProgress ?? (() => {});
  const guard = new FailureGuard();
  const center = await ingestChannel(deps, input);
  const centerChannelId = center.channel.id;

  let members: readonly MapMember[] = [{ channelId: centerChannelId, steps: 0 }];
  let frontier: readonly string[] = [centerChannelId];
  let warnings: readonly string[] = [];

  for (let step = 1; step <= settings.depth && frontier.length > 0 && !guard.tripped; step += 1) {
    report({ stage: 'reading-recommendations', step, channels: members.length });
    const readings = await inBatches(
      frontier,
      guard,
      (id) => readEdges(deps, id, settings, guard),
      (): Reading => ({ edges: [], warning: null }),
    );
    const candidates = rankCandidates(
      readings.flatMap((reading) => reading.edges),
      new Set(members.map((member) => member.channelId)),
    );
    const room = Math.max(0, settings.maxChannels - members.length);
    const chosen = candidates.slice(0, room);

    report({ stage: 'reading-channels', step, channels: members.length + chosen.length });
    const outcomes = await inBatches(
      chosen,
      guard,
      (id) => ingestNeighbour(deps, id, guard),
      (channelId): IngestOutcome => ({ channelId, error: NOT_ATTEMPTED }),
    );
    const added = outcomes
      .filter((outcome) => outcome.error === null)
      .map((outcome): MapMember => ({ channelId: outcome.channelId, steps: step }));

    warnings = [
      ...warnings,
      ...stepWarnings(readings, outcomes, candidates.length - room, step, settings),
    ];
    members = [...members, ...added];
    frontier = added.map((member) => member.channelId);
  }

  const mapId = deps.maps.create(
    { centerChannelId, depth: settings.depth, region: deps.region, members },
    deps.now(),
  );
  report({ stage: 'done', channels: members.length });
  return { mapId, centerChannelId, depth: settings.depth, members, warnings };
}
