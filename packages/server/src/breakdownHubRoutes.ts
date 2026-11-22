/**
 * The routes of the Breakdown view: the channels it offers (with what the
 * chooser shows of each), reading a pasted channel, and the deep breakdown
 * of one video from a YouTube link or a file the owner gives. Every write
 * passes the Host, Origin and JSON checks the other routes use; every body
 * is checked with zod. A one-video run is a job of its own, listed at
 * `GET /api/jobs` as `video-breakdown`, and takes the one slot every AI run
 * shares.
 */
import {
  newUploadKey,
  parseChannelRef,
  parseVideoRef,
  pathInside,
  uploadKindOf,
  type UploadKind,
} from '@jgtube/core';
import { randomUUID } from 'node:crypto';
import { mkdir, open, rename, rm } from 'node:fs/promises';
import { z } from 'zod';
import type { AnalysisTracker } from './analysisRoutes';
import type { AppOptions } from './app';
import { MAX_CANDIDATES } from './breakdownCandidates';
import { OverTheCap, tooLarge, maxBytesOf, writeBody, type UploadTracker } from './breakdownRoutes';
import { isWholeMp4 } from './engines/mp4';
import { ENGINE_IDS } from './engines/settings';
import { fail, isCrossSite, ok, readJson } from './http';
import { JobStore, cleanMessage, type JobRecord } from './jobs';
import type { OneVideoProgress, VideoBreakdownView, VideoTarget } from './oneVideoTypes';
import { teardownRoutes } from './teardownRoutes';

export const CANDIDATES_PATH = '/api/breakdowns/candidates';
export const READ_CHANNEL_PATH = '/api/breakdowns/channel';
export const VIDEO_BREAKDOWNS_PATH = '/api/video-breakdowns';
export const VIDEO_FILES_PATH = '/api/video-breakdowns/files';

const CHANNEL_ID = /^UC[\w-]{22}$/;
const MAX_REF_LENGTH = 200;
const MAX_NAME_LENGTH = 120;
/** A list of up to `MAX_CANDIDATES` channel ids, with room for the JSON around them. */
const MAX_CANDIDATES_BODY = 40_000;
const AI_BUSY = 'An AI run is already under way. Wait for it to finish.';
const VIDEO_BUSY = 'A video is already being broken down. Wait for it to finish.';
const BAD_VIDEO =
  'Give a YouTube video link (youtube.com/watch?v=… or youtu.be/…) or the video’s 11-character id.';
const NOT_A_CHANNEL =
  'Give a channel: an @handle, a youtube.com channel link or a channel id (UC…).';
/** WebM files start with these four bytes (the EBML header). */
const WEBM_MAGIC = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);

export type VideoBreakdownJobs = JobStore<VideoBreakdownView, OneVideoProgress>;

const candidatesRequest = z.object({
  ids: z.array(z.string().regex(CHANNEL_ID)).max(MAX_CANDIDATES),
});
const readRequest = z.object({ channel: z.string().min(1).max(MAX_REF_LENGTH) });
const videoRequest = z
  .object({
    video: z.string().min(1).max(MAX_REF_LENGTH).optional(),
    file: z
      .string()
      .regex(/^[\w-]{11}$/)
      .optional(),
    name: z.string().max(MAX_NAME_LENGTH).optional(),
    engine: z.enum(ENGINE_IDS).optional(),
    fresh: z.boolean().optional(),
  })
  .refine((body) => (body.video === undefined) !== (body.file === undefined));

/** A file's name as shown: no control or path characters, never empty. */
export function shownName(name: string | undefined): string {
  const plain = (name ?? '').replace(/[\u0000-\u001f\u007f/\\]/g, ' ').trim();
  return plain === '' ? 'Your video file' : plain.slice(0, MAX_NAME_LENGTH);
}

function videoIdOf(text: string): string | null {
  try {
    return parseVideoRef(text);
  } catch {
    return null;
  }
}

/** The target a request names, or the response that refuses it. */
async function targetOf(
  options: AppOptions,
  body: z.infer<typeof videoRequest>,
): Promise<VideoTarget | Response> {
  if (body.file !== undefined) {
    if (!(await options.engine.hub.hasUpload(body.file))) {
      return fail(404, 'That video file is no longer on this computer. Choose it again.');
    }
    return { kind: 'file', videoId: body.file, name: shownName(body.name) };
  }
  const videoId = videoIdOf(body.video ?? '');
  return videoId === null ? fail(400, BAD_VIDEO) : { kind: 'youtube', videoId };
}

interface HubContext {
  readonly options: AppOptions;
  readonly tracker: AnalysisTracker;
  readonly jobs: VideoBreakdownJobs;
  readonly uploading: UploadTracker;
}

async function startVideo(context: HubContext, request: Request): Promise<Response> {
  const { options, tracker, jobs } = context;
  const body = await readJson(options.allowedHosts, request);
  if (body instanceof Response) return body;
  const parsed = videoRequest.safeParse(body);
  if (!parsed.success) return fail(400, BAD_VIDEO);
  const target = await targetOf(options, parsed.data);
  if (target instanceof Response) return target;
  if (tracker.running) return fail(409, AI_BUSY);
  if (jobs.isBusy()) return fail(409, VIDEO_BUSY);
  const { engine: only, fresh } = parsed.data;
  tracker.running = true;
  const title = target.kind === 'file' ? `Breaking down ${target.name}` : 'Breaking down a video';
  const job = jobs.start(
    (report) =>
      options.engine.hub.breakDownVideo(target, report, { only, fresh }).finally(() => {
        tracker.running = false;
      }),
    { kind: 'video-breakdown', title, videoId: target.videoId },
  );
  if (!job) {
    tracker.running = false;
    return fail(409, VIDEO_BUSY);
  }
  return ok({ jobId: job.id, video: target.videoId }, 202);
}

function readVideos(options: AppOptions, url: URL): Response {
  const video = url.searchParams.get('video');
  if (video === null) return ok({ items: options.engine.hub.videoBreakdowns() });
  if (!/^[\w-]{11}$/.test(video)) return fail(400, BAD_VIDEO);
  return ok(options.engine.hub.findVideoBreakdown(video));
}

async function candidates(options: AppOptions, request: Request): Promise<Response> {
  const body = await readJson(options.allowedHosts, request, MAX_CANDIDATES_BODY);
  if (body instanceof Response) return body;
  const parsed = candidatesRequest.safeParse(body);
  if (!parsed.success) return fail(400, `Give up to ${MAX_CANDIDATES} channel ids`);
  return ok({ candidates: options.engine.hub.candidates(parsed.data.ids) });
}

function isChannel(text: string): boolean {
  try {
    parseChannelRef(text);
    return true;
  } catch {
    return false;
  }
}

/** Reads a pasted channel (its page and recent videos) when it is not stored, in the slot crawls use. */
async function readChannel(options: AppOptions, request: Request): Promise<Response> {
  const body = await readJson(options.allowedHosts, request);
  if (body instanceof Response) return body;
  const parsed = readRequest.safeParse(body);
  if (!parsed.success || !isChannel(parsed.data.channel.trim())) return fail(400, NOT_A_CHANNEL);
  if (options.engine.isReadingYouTube()) {
    return fail(409, 'Jgtube is reading YouTube for something else. Try again in a minute.');
  }
  const held = options.jobs.hold(() =>
    options.engine.hub.readCandidate(parsed.data.channel.trim()),
  );
  if (held === null) {
    return fail(
      409,
      'Jgtube is reading YouTube for a map or a refresh. Try again when it is done.',
    );
  }
  try {
    return ok({ candidate: await held });
  } catch (error) {
    return fail(502, `That channel could not be read from YouTube: ${cleanMessage(error)}`);
  }
}

/** Whether the file is the kind it says: a whole MP4 or MOV, or one that starts as WebM does. */
async function isKind(path: string, kind: UploadKind): Promise<boolean> {
  if (kind.extension !== '.webm') return isWholeMp4(path);
  const file = await open(path, 'r');
  try {
    const head = Buffer.alloc(WEBM_MAGIC.length);
    await file.read(head, 0, head.length, 0);
    return head.equals(WEBM_MAGIC);
  } finally {
    await file.close();
  }
}

/** Why an upload is refused before a byte of it is read, or null when it may go ahead. */
function uploadRefusal(options: AppOptions, request: Request): Response | UploadKind {
  if (isCrossSite(request, options.allowedHosts)) {
    return fail(403, 'Requests from other sites are not accepted');
  }
  const kind = uploadKindOf(request.headers.get('content-type') ?? '');
  if (kind === null) return fail(415, 'Only MP4, WebM and MOV video files are taken.');
  const announced = Number(request.headers.get('content-length') ?? '0');
  return announced > maxBytesOf(options) ? tooLarge(options) : kind;
}

/**
 * Saves a video file the owner gives under a new id, in the folder of their
 * own files. Streamed to a temporary name and renamed only once it is whole
 * and of the kind it claims; nothing is left behind otherwise.
 */
async function uploadFile(context: HubContext, request: Request): Promise<Response> {
  const { options, uploading } = context;
  const kind = uploadRefusal(options, request);
  if (kind instanceof Response) return kind;
  if (uploading.busy) return fail(409, 'Another video file is being sent. Wait for it to finish.');
  if (request.body === null) return fail(400, 'No file was sent.');
  uploading.busy = true;
  let partial: string | null = null;
  try {
    const folder = options.engine.ownVideosFolder();
    const key = newUploadKey();
    await mkdir(folder, { recursive: true });
    partial = pathInside(folder, `${key}${kind.extension}.part-${randomUUID()}`);
    const bytes = await writeBody(request.body, partial, maxBytesOf(options));
    if (bytes === 0) return fail(400, 'No file was sent.');
    if (!(await isKind(partial, kind))) {
      return fail(400, 'That file is not a complete video of the kind its name says.');
    }
    await rename(partial, pathInside(folder, `${key}${kind.extension}`));
    partial = null;
    return ok({ file: key, bytes, kind: kind.extension.slice(1) }, 201);
  } catch (error) {
    if (error instanceof OverTheCap) return tooLarge(options);
    return fail(400, `The file did not arrive whole: ${cleanMessage(error)}`);
  } finally {
    if (partial !== null) await rm(partial, { force: true }).catch(() => undefined);
    uploading.busy = false;
  }
}

export interface HubRoutes {
  /** The answer to a request for one of these paths; null for any other path. */
  handle(request: Request, url: URL): Promise<Response> | Response | null;
  listJobs(): readonly JobRecord[];
  job(id: string): ReturnType<VideoBreakdownJobs['get']>;
}

export function hubRoutes(
  options: AppOptions,
  tracker: AnalysisTracker,
  uploading: UploadTracker,
): HubRoutes {
  const context: HubContext = { options, tracker, jobs: new JobStore(), uploading };
  const only = (method: string, request: Request, run: () => Promise<Response> | Response) =>
    request.method === method ? run() : fail(405, `Use ${method}`);
  return {
    handle(request, url) {
      switch (url.pathname) {
        case CANDIDATES_PATH:
          return only('POST', request, () => candidates(options, request));
        case READ_CHANNEL_PATH:
          return only('POST', request, () => readChannel(options, request));
        case VIDEO_FILES_PATH:
          return only('PUT', request, () => uploadFile(context, request));
        case VIDEO_BREAKDOWNS_PATH:
          if (request.method === 'GET') return readVideos(options, url);
          return only('POST', request, () => startVideo(context, request));
        default:
          return teardownRoutes(options, request, url);
      }
    },
    listJobs: () => context.jobs.list(),
    job: (id) => context.jobs.get(id),
  };
}
