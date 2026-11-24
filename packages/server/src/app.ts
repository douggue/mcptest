import {
  COMPETITOR_STATUSES,
  CRAWL_DEFAULT_DEPTH,
  CRAWL_MAX_CHANNELS_ASKED,
  CRAWL_MAX_DEPTH,
  CRAWL_MIN_CHANNELS_ASKED,
  READING_ELSEWHERE,
  ReadingElsewhereError,
  parseChannelRef,
  type CompetitorStatus,
  type CrawlProgress,
  type BreakdownFileId,
  type BreakdownTextFile,
  type DiscoveryResult,
  type FactsOutcome,
  type MeasuredChannelFacts,
  type MapSnapshot,
  type NicheList,
  type SavedChannel,
  type Place,
  type RefreshProgress,
  type RefreshStatus,
  type SameTopicList,
  type ThumbnailBoard,
  type TransferList,
} from '@jgtube/core';
import { z } from 'zod';
import { fail, isTrustedHost, ok, readJson } from './http';
import { channelLabel } from './jobLabels';
import { heldRuns, listJobs } from './jobList';
import { JobStore, cleanMessage } from './jobs';
import type { AnalysisId } from './analyses';
import type { AnswerEngine } from './answerEngine';
import type { ConceptThumbEngine } from './conceptThumbEngine';
import type { FlowEngine } from './flowEngine';
import type { ResearchEngine } from './researchEngine';
import type { StyleLockEngine } from './styleLockEngine';
import { readFlow, styleLockRoute } from './styleLockRoutes';
import { NAMED_VIDEOS_PATH, readAnswer, readNamedVideos } from './answerRoutes';
import { readEngines, runAnalysis, type AnalysisTracker } from './analysisRoutes';
import { OWN_QUESTION_PATH, askOwnQuestion, readOwnAnswer } from './ownQuestionRoutes';
import { PICTURE_CHECK_PATH, runPictureCheckRoute } from './pictureCheckRoutes';
import type { EngineReport } from './engines/catalog';
import type { EngineAnswer } from './engines/fallback';
import type { EngineId } from './engines/types';
import type { PictureCheckRecord } from './pictureChecks';
import type { VideoAnswer, WatchOptions } from './engines/videoWatch';
import type { QuestionFocus } from './questionFocus';
import type {
  BreakdownChoices,
  BreakdownOutcome,
  BreakdownProgress,
  BreakdownView,
} from './breakdownTypes';
import { refreshState, startRefresh, type RefreshTracker } from './refreshRoutes';
import {
  BREAKDOWN_TEXT_PATH,
  downloadBreakdownText,
  readBreakdown,
  startBreakdown,
  uploadVideo,
  type BreakdownJobs,
  type UploadTracker,
} from './breakdownRoutes';
import { downloadThumbnails, downloadTranscripts } from './downloadRoutes';
import type { DownloadsEngine } from './downloadTypes';
import { hubRoutes } from './breakdownHubRoutes';
import { extraRoutes } from './extrasRoutes';
import { formatRoutes } from './formatRoutes';
import type { FormatEngine } from './formatTypes';
import type { BreakdownHub } from './oneVideoTypes';
import type { ExtrasEngine } from './extrasTypes';
import { labRoutes, type LabRoutes } from './labRoutes';
import type { LabEngine } from './labTypes';
import { LOGOS_PATH, logoRoutes, type LogoRoutes } from './logoRoutes';
import type { LogoEngine } from './logoTypes';
import type { ScriptEngine } from './scriptTypes';
import { settingsRoute, type SettingsEngine } from './settingsRoutes';
import type { TransferPlaceEngine } from './transferEngine';
import { readCountries, readTransfers, saveTransfer, setPlace } from './transferRoutes';

const CHANNEL_ID = /^UC[\w-]{22}$/;
const MAX_KEYWORD_LENGTH = 200;
export const BUSY =
  'A map, a refresh or a keyword search is already running. Wait for it to finish.';
const NO_API_KEY =
  'Keyword search needs a YouTube API key. Put YOUTUBE_API_KEY in the .env file and start Jgtube again.';

export interface CrawlOutcome {
  readonly centerChannelId: string;
  readonly warnings: readonly string[];
}

/** How one refresh went, as counts. */
export interface RefreshOutcome {
  readonly refreshed: number;
  readonly failed: number;
  /** Channels left unread because YouTube refused several in a row. */
  readonly notAttempted: number;
  readonly stoppedEarly: boolean;
  /** Channels still due for a read; a later refresh takes them. */
  readonly stillDue: number;
  /** Niche channels whose account date and country were read from the official API. */
  readonly factsAdded: number;
  /** Why those could not be read; null when they were, or when no API key is set. */
  readonly factsProblem: string | null;
}

/** What a keyword search found, and how reading the new channels' account dates went. */
export interface DiscoveryOutcome extends DiscoveryResult {
  /** Absent or null when no facts were asked for. */
  readonly facts?: FactsOutcome | null;
}

/** When the store was last refreshed, how much is due, and whether a timer does it. */
export interface RefreshState extends RefreshStatus {
  /** Hours between scheduled refreshes; null when none is scheduled. */
  readonly everyHours: number | null;
}

/** What a finished job leaves behind, and what it reports on the way. */
export type JobOutcome = CrawlOutcome | RefreshOutcome;
export type JobProgress = CrawlProgress | RefreshProgress;

export interface CrawlChoices {
  /** A channel the owner wants to be like; the map is measured against it. */
  readonly model?: string | undefined;
  /** The most channels the map may hold, centre included. */
  readonly maxChannels?: number | undefined;
}

/** What the transfer list is judged for. */
export interface TransferChoices {
  /** The channel on screen: its own place is taken as the owner's, when it can be told. */
  readonly channel?: string;
  /** The owner's place, when they name it themselves. */
  readonly place?: Place;
}

/** What the API needs from the engine, so tests can stand in for it. */
export interface Engine
  extends
    DownloadsEngine,
    LabEngine,
    ScriptEngine,
    LogoEngine,
    TransferPlaceEngine,
    AnswerEngine,
    ConceptThumbEngine,
    StyleLockEngine,
    FlowEngine,
    ResearchEngine {
  /** The later features, kept together: what changed since the owner last looked. */
  readonly extras: ExtrasEngine;
  /** The format builder: the shelf of ingredients taken from the other views. */
  readonly formats: FormatEngine;
  /** The Breakdown view: the channels it offers, a pasted channel, and one video in depth. */
  readonly hub: BreakdownHub;
  /** The latest stored map around a channel; reads the store only. */
  findSnapshot(channel: string): MapSnapshot | null;
  /** Every channel a map has been made for, the most recently mapped first. */
  listSavedChannels(): readonly SavedChannel[];
  /**
   * Deletes a saved channel's maps and the choices made for it; what was read
   * about the channels stays. False when the channel has no map.
   */
  deleteSavedChannel(channelId: string): boolean;
  /** The thumbnails that worked around a channel, from its latest map; reads the store only. */
  findThumbnailBoard(channel: string): ThumbnailBoard | null;
  /**
   * The channels on a channel's latest map that were left out on title wording
   * alone, for the owner to judge; reads the store only.
   */
  findSameTopic(channel: string): SameTopicList | null;
  crawl(
    channel: string,
    depth: number,
    onProgress: (progress: CrawlProgress) => void,
    choices?: CrawlChoices,
  ): Promise<CrawlOutcome>;
  /**
   * Records the owner's say on a channel of the centre's latest map.
   * False when the channel is not on that map, or is the centre itself.
   */
  setCompetitorStatus(
    centerChannelId: string,
    channelId: string,
    status: CompetitorStatus,
  ): boolean;
  /** New or small channels in the store with a video that took off, and the watched ones; reads the store only. */
  listNiches(): NicheList;
  /** Marks a channel as a niche to watch, or unmarks it. False when it is not in the store. */
  setNicheWatched(channelId: string, watched: boolean): boolean;
  /**
   * Ideas several channels made, each judged as a transfer opportunity for the
   * owner's place, and the title formats used for several subjects; reads the store only.
   */
  listTransfers(choices?: TransferChoices): TransferList;
  /**
   * Saves an idea as a transfer opportunity, or stops saving it. False when
   * asked to save an idea no recent video has.
   */
  setTransferSaved(key: string, saved: boolean): boolean;
  /**
   * Reads the stalest stored channels again so history builds up; `maxChannels`
   * bounds the run. Resolves when the run is over.
   */
  refresh(
    onProgress: (progress: RefreshProgress) => void,
    maxChannels?: number,
  ): Promise<RefreshOutcome>;
  /** When the store was last refreshed and how much of it is due; reads the store only. */
  refreshStatus(): RefreshState;
  /**
   * Whether work that reads YouTube is under way in any program that shares the
   * store: this server, the connector or the command line. Reads the store only.
   */
  isReadingYouTube(): boolean;
  /** Whether keyword search can run: it needs the owner's YouTube API key. */
  canDiscover(): boolean;
  /** Searches for recent videos on a subject and reads the channels behind them into the store. */
  discover(keyword: string): Promise<DiscoveryOutcome>;
  /**
   * Puts one of the fixed analyses to the first AI engine that can run, for a
   * channel, and returns its answer as plain text. Rejects with an
   * EngineRunError when none can, or when the one that ran failed.
   */
  analyse(
    analysis: AnalysisId,
    channel: string,
    /** The one engine the owner chose for this run; absent, the usual order with its backups. */
    only?: EngineId,
    /** What else the question is told, chosen or checked in code. */
    focus?: QuestionFocus,
    /** An engine not to use this time: a rerun of a picture part on another engine. */
    avoid?: EngineId,
  ): Promise<EngineAnswer<EngineId>>;
  /**
   * Has an engine watch one YouTube video, picture and sound, and answer a
   * question about it. Rejects with an EngineRunError: 'not-installed' when no
   * engine on this computer can watch video.
   */
  /**
   * What code measured across one stored channel's top and ordinary videos:
   * title patterns, thumbnail checklist counts, pace, words, loudness,
   * colours, transitions and camera moves. Null for a channel not stored.
   */
  channelMeasurements(channel: string): MeasuredChannelFacts | null;
  watchVideo(videoId: string, question: string, options?: WatchOptions): Promise<VideoAnswer>;
  /**
   * Which AI engines are installed and signed in. Starts nothing that spends
   * allowance. What was found is reused for a minute unless `fresh` is true.
   */
  engineStatus(fresh?: boolean): Promise<EngineReport>;
  /**
   * Checks that an engine sees the pictures it is handed as files, and keeps
   * the result: a pass lets it answer the picture questions that can hand it
   * files. Rejects with an EngineRunError, keeping nothing, when the run fails.
   */
  checkPictures(engine: EngineId): Promise<PictureCheckRecord>;
  /**
   * Breaks one channel down: studies its top videos, in depth for the best
   * few, and has an engine write the breakdown. Takes many minutes; what
   * could not be done is in the outcome with its reason. Rejects when the
   * channel cannot be read, when no engine could write, or when Jgtube is closing.
   */
  breakDown(
    channel: string,
    onProgress: (progress: BreakdownProgress) => void,
    choices?: BreakdownChoices,
  ): Promise<BreakdownOutcome>;
  /**
   * A channel's stored breakdown as the page shows it; reads the store and
   * looks for its saved files. Null when the channel is not stored or has none.
   */
  findBreakdown(channel: string): Promise<BreakdownView | null>;
  /**
   * One of a stored breakdown's four texts, put together from its stored
   * parts, with the channel it is of; reads the store only. Null when the
   * channel is not stored.
   */
  breakdownText(
    channel: string,
    file: BreakdownFileId,
  ): {
    readonly channel: { readonly id: string; readonly title: string };
    readonly file: BreakdownTextFile;
  } | null;
  /**
   * The folder the owner's own video files are kept in, as a full path.
   * Throws when the store is only in memory and no downloads folder is named.
   */
  ownVideosFolder(): string;
}

export interface AppOptions {
  readonly engine: Engine;
  /** Crawls, refreshes and keyword searches all read YouTube, so only one of them runs at a time. */
  readonly jobs: JobStore<JobOutcome, JobProgress>;
  /** The only `host:port` values this server answers to, such as `127.0.0.1:4317`. */
  readonly allowedHosts: readonly string[];
  /** The owner's settings in the `.env` file; absent where there is none to write. */
  readonly settings?: SettingsEngine;
  /** The largest video file taken from the page; tests shorten it. */
  readonly maxUploadBytes?: number;
}

/** Where the owner's own video files are sent, followed by the video's id. */
export const UPLOAD_PATH = '/api/breakdowns/videos/';

const crawlRequest = z.object({
  channel: z.string().min(1).max(200),
  depth: z.number().int().min(1).max(CRAWL_MAX_DEPTH).optional(),
  model: z.string().min(1).max(200).optional(),
  maxChannels: z
    .number()
    .int()
    .min(CRAWL_MIN_CHANNELS_ASKED)
    .max(CRAWL_MAX_CHANNELS_ASKED)
    .optional(),
});

const competitorRequest = z.object({
  center: z.string().regex(CHANNEL_ID),
  channel: z.string().regex(CHANNEL_ID),
  status: z.enum(COMPETITOR_STATUSES),
});

const watchRequest = z.object({
  channel: z.string().regex(CHANNEL_ID),
  watched: z.boolean(),
});

/**
 * Why work that reads YouTube cannot start now, or null when it can: something
 * is running here, or another program that shares the store is reading YouTube.
 */
export function refusal(options: AppOptions): Response | null {
  if (options.jobs.isBusy()) return fail(409, BUSY);
  return options.engine.isReadingYouTube() ? fail(409, READING_ELSEWHERE) : null;
}

/** Returns the reason a channel reference is unusable, or null when it is fine. */
function channelProblem(channel: string): string | null {
  try {
    parseChannelRef(channel);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : 'Not a valid channel';
  }
}

/** Answers a read about a channel's latest map, once the channel reference is known to be usable. */
function readLatest<T>(url: URL, find: (channel: string) => T | null): Response {
  const channel = url.searchParams.get('channel') ?? '';
  const problem = channelProblem(channel);
  if (problem) return fail(400, problem);
  const found = find(channel);
  return found ? ok(found) : fail(404, 'No map has been made for this channel yet');
}

async function startCrawl(options: AppOptions, request: Request): Promise<Response> {
  const body = await readJson(options.allowedHosts, request);
  if (body instanceof Response) return body;
  const parsed = crawlRequest.safeParse(body);
  if (!parsed.success) {
    return fail(
      400,
      `Give a channel and, optionally, a depth of 1 to ${CRAWL_MAX_DEPTH} and a size of ${CRAWL_MIN_CHANNELS_ASKED} to ${CRAWL_MAX_CHANNELS_ASKED} channels`,
    );
  }
  const { channel, depth = CRAWL_DEFAULT_DEPTH, model, maxChannels } = parsed.data;
  const problem = channelProblem(channel);
  if (problem) return fail(400, problem);
  const modelProblem = model === undefined ? null : channelProblem(model);
  if (modelProblem) return fail(400, `Model channel: ${modelProblem}`);

  const refused = refusal(options);
  if (refused) return refused;
  const job = options.jobs.start(
    (report) => options.engine.crawl(channel, depth, report, { model, maxChannels }),
    channelLabel(options.engine, 'map', 'Making a map of', channel),
  );
  if (!job) return fail(409, BUSY);
  return ok({ jobId: job.id }, 202);
}

async function setCompetitor(options: AppOptions, request: Request): Promise<Response> {
  const body = await readJson(options.allowedHosts, request);
  if (body instanceof Response) return body;
  const parsed = competitorRequest.safeParse(body);
  if (!parsed.success) {
    return fail(
      400,
      `Give the centre channel, the channel and a status: ${COMPETITOR_STATUSES.join(', ')}`,
    );
  }
  const { center, channel, status } = parsed.data;
  return options.engine.setCompetitorStatus(center, channel, status)
    ? ok({ center, channel, status })
    : fail(404, 'That channel is not on the latest map of this centre channel');
}

async function setWatched(options: AppOptions, request: Request): Promise<Response> {
  const body = await readJson(options.allowedHosts, request);
  if (body instanceof Response) return body;
  const parsed = watchRequest.safeParse(body);
  if (!parsed.success) return fail(400, 'Give the channel and watched');
  const { channel, watched } = parsed.data;
  return options.engine.setNicheWatched(channel, watched)
    ? ok({ channel, watched })
    : fail(404, 'That channel has not been read yet');
}

/** The requests that start work reading YouTube; a logo job under way steps aside for each. */
const READS_YOUTUBE: ReadonlySet<string> = new Set([
  '/api/maps',
  '/api/niches/discover',
  '/api/refresh',
]);

const deleteRequest = z.object({ channel: z.string().regex(CHANNEL_ID) });

/** Deletes a saved channel's maps. Refused while a map is being made, which may be this one. */
async function deleteSaved(options: AppOptions, request: Request): Promise<Response> {
  const body = await readJson(options.allowedHosts, request);
  if (body instanceof Response) return body;
  const parsed = deleteRequest.safeParse(body);
  if (!parsed.success) return fail(400, 'Give the id of the channel to delete');
  if (options.jobs.isBusy()) return fail(409, BUSY);
  const { channel } = parsed.data;
  return options.engine.deleteSavedChannel(channel)
    ? ok({ channel })
    : fail(404, 'No map has been made for that channel');
}

const discoverRequest = z.object({ keyword: z.string().trim().min(1).max(MAX_KEYWORD_LENGTH) });

/** The counts the screen shows for a finished keyword search. */
function discoverySummary(found: DiscoveryOutcome): Record<string, unknown> {
  return {
    keyword: found.keyword,
    videosFound: found.videosFound,
    channelsFound: found.channelsFound,
    added: found.added.length,
    alreadyKnown: found.alreadyKnown.length,
    failed: found.failed.length,
    factsAdded: found.facts?.added ?? 0,
    factsProblem: found.facts?.problem ?? null,
  };
}

/**
 * Runs a keyword search and answers when it is done. It reads YouTube like a
 * crawl or a refresh does, so it takes the same one slot: it is refused while
 * either runs (here or in another program), and they are refused while it does.
 */
async function discover(options: AppOptions, request: Request): Promise<Response> {
  const body = await readJson(options.allowedHosts, request);
  if (body instanceof Response) return body;
  const parsed = discoverRequest.safeParse(body);
  if (!parsed.success) return fail(400, `Give a keyword of 1 to ${MAX_KEYWORD_LENGTH} characters`);
  if (!options.engine.canDiscover()) return fail(400, NO_API_KEY);

  const refused = refusal(options);
  if (refused) return refused;
  const search = options.jobs.hold(() => options.engine.discover(parsed.data.keyword));
  if (!search) return fail(409, BUSY);
  try {
    return ok(discoverySummary(await search));
  } catch (error) {
    // Another program took the lease between the check above and the search.
    return error instanceof ReadingElsewhereError
      ? fail(409, error.message)
      : fail(502, `The search did not finish: ${cleanMessage(error)}`);
  }
}

/** One job's state, whichever kind it is: a crawl or a refresh, a breakdown, or one of the idea lab's. */
function jobStatus(
  options: AppOptions,
  breakdowns: BreakdownJobs,
  lab: LabRoutes,
  logos: LogoRoutes,
  id: string,
  hub: ReturnType<typeof hubRoutes>,
): Response {
  const job =
    options.jobs.get(id) ?? breakdowns.get(id) ?? lab.job(id) ?? logos.job(id) ?? hub.job(id);
  return job ? ok(job) : fail(404, 'No such job');
}

/** The JSON API as a plain function from request to response. */
export function createApp(options: AppOptions): (request: Request) => Promise<Response> {
  const refreshing: RefreshTracker = { jobId: null };
  // An analysis and a breakdown each keep an AI engine busy, so they share this one slot.
  const held = heldRuns();
  const analysing: AnalysisTracker = { running: false, held };
  // Breakdowns have a store of their own: they read YouTube a little and an
  // engine a lot, so they do not take the slot that crawls and refreshes share.
  const breakdowns: BreakdownJobs = new JobStore();
  const uploading: UploadTracker = { busy: false };
  // The idea lab's AI runs take the same one slot as an analysis or a breakdown.
  const lab = labRoutes(options, analysing);
  const logos = logoRoutes({
    engine: options.engine,
    allowedHosts: options.allowedHosts,
    isReading: () => options.jobs.isBusy() || options.engine.isReadingYouTube(),
    channelProblem,
  });
  const extra = extraRoutes(options, analysing);
  const hub = hubRoutes(options, analysing, uploading);
  return async (request) => {
    if (!isTrustedHost(request, options.allowedHosts)) {
      return fail(403, 'This server only answers to its own address');
    }
    const url = new URL(request.url);
    const { pathname } = url;
    const { method } = request;

    const settingsAnswer = settingsRoute(options.settings, options.allowedHosts, request, pathname);
    if (settingsAnswer) return settingsAnswer;
    const labAnswer = lab.handle(request, url);
    if (labAnswer) return labAnswer;
    if (method === 'POST' && READS_YOUTUBE.has(pathname)) await logos.standDown();
    if (pathname === LOGOS_PATH) {
      return method === 'POST' ? logos.start(request) : fail(405, 'Use POST');
    }
    const hubAnswer = hub.handle(request, url);
    if (hubAnswer) return hubAnswer;
    const extraAnswer = extra.handle(request, url);
    if (extraAnswer) return extraAnswer;
    const formatAnswer = formatRoutes(options, request, url);
    if (formatAnswer) return formatAnswer;
    if (pathname === '/api/maps/latest') {
      return method === 'GET'
        ? readLatest(url, (channel) => options.engine.findSnapshot(channel))
        : fail(405, 'Use GET');
    }
    if (pathname === '/api/maps/latest/thumbnails') {
      return method === 'GET'
        ? readLatest(url, (channel) => options.engine.findThumbnailBoard(channel))
        : fail(405, 'Use GET');
    }
    if (pathname === '/api/maps/latest/same-topic') {
      return method === 'GET'
        ? readLatest(url, (channel) => options.engine.findSameTopic(channel))
        : fail(405, 'Use GET');
    }
    if (pathname === '/api/maps') {
      if (method === 'GET') return ok({ channels: options.engine.listSavedChannels() });
      return method === 'POST' ? startCrawl(options, request) : fail(405, 'Use GET or POST');
    }
    if (pathname === '/api/maps/delete') {
      return method === 'POST' ? deleteSaved(options, request) : fail(405, 'Use POST');
    }
    if (pathname === '/api/competitors') {
      return method === 'POST' ? setCompetitor(options, request) : fail(405, 'Use POST');
    }
    if (pathname === '/api/niches') {
      return method === 'GET'
        ? ok({ ...options.engine.listNiches(), canDiscover: options.engine.canDiscover() })
        : fail(405, 'Use GET');
    }
    if (pathname === '/api/niches/discover') {
      return method === 'POST' ? discover(options, request) : fail(405, 'Use POST');
    }
    if (pathname === '/api/niches/watch') {
      return method === 'POST' ? setWatched(options, request) : fail(405, 'Use POST');
    }
    if (pathname === '/api/transfers') {
      return method === 'GET' ? readTransfers(options, url, channelProblem) : fail(405, 'Use GET');
    }
    if (pathname === '/api/transfers/place') {
      return method === 'POST' ? setPlace(options, request) : fail(405, 'Use POST');
    }
    if (pathname === '/api/transfers/countries') {
      return method === 'POST' ? readCountries(options, request) : fail(405, 'Use POST');
    }
    if (pathname === '/api/transfers/save') {
      return method === 'POST' ? saveTransfer(options, request) : fail(405, 'Use POST');
    }
    if (pathname === '/api/thumbnails/download') {
      return method === 'POST' ? downloadThumbnails(options, request) : fail(405, 'Use POST');
    }
    if (pathname === '/api/transcripts/download') {
      return method === 'POST' ? downloadTranscripts(options, request) : fail(405, 'Use POST');
    }
    if (pathname === '/api/breakdowns') {
      if (method === 'GET') return readBreakdown(options, url);
      return method === 'POST'
        ? startBreakdown(options, request, breakdowns, analysing)
        : fail(405, 'Use GET or POST');
    }
    if (pathname.startsWith(BREAKDOWN_TEXT_PATH)) {
      const name = pathname.slice(BREAKDOWN_TEXT_PATH.length);
      return method === 'GET' ? downloadBreakdownText(options, url, name) : fail(405, 'Use GET');
    }
    if (pathname.startsWith(UPLOAD_PATH)) {
      const videoId = pathname.slice(UPLOAD_PATH.length);
      return method === 'PUT'
        ? uploadVideo(options, request, videoId, uploading)
        : fail(405, 'Use PUT');
    }
    if (pathname === '/api/refresh') {
      if (method === 'GET') return refreshState(options, refreshing);
      return method === 'POST'
        ? startRefresh(options, request, refreshing)
        : fail(405, 'Use GET or POST');
    }
    if (pathname === OWN_QUESTION_PATH) {
      if (method === 'GET') return readOwnAnswer(options, url);
      return method === 'POST'
        ? askOwnQuestion(options, request, analysing)
        : fail(405, 'Use GET or POST');
    }
    if (pathname === '/api/analyses') {
      if (method === 'GET') return readAnswer(options, url);
      return method === 'POST'
        ? runAnalysis(options, request, analysing)
        : fail(405, 'Use GET or POST');
    }
    if (pathname === '/api/flow') {
      return method === 'GET' ? readFlow(options, url) : fail(405, 'Use GET');
    }
    const styleLock = styleLockRoute(options, request, url);
    if (styleLock !== null) return styleLock;
    if (pathname === NAMED_VIDEOS_PATH) {
      return method === 'GET' ? readNamedVideos(options, url) : fail(405, 'Use GET');
    }
    if (pathname === PICTURE_CHECK_PATH) {
      return method === 'POST'
        ? runPictureCheckRoute(options, request, analysing)
        : fail(405, 'Use POST');
    }
    if (pathname === '/api/engines') {
      return method === 'GET' ? readEngines(options) : fail(405, 'Use GET');
    }
    if (pathname === '/api/jobs') {
      if (method !== 'GET') return fail(405, 'Use GET');
      const sources = [options.jobs, breakdowns, held].map((store) => () => store.list());
      return ok({
        jobs: listJobs([...sources, lab.listJobs, logos.listJobs, extra.listJobs, hub.listJobs]),
      });
    }
    if (pathname.startsWith('/api/jobs/')) {
      const id = pathname.slice('/api/jobs/'.length);
      return method === 'GET'
        ? jobStatus(options, breakdowns, lab, logos, id, hub)
        : fail(405, 'Use GET');
    }
    return fail(404, 'Not found');
  };
}
