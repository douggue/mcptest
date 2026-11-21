import { MAX_OWN_VIDEO_BYTES, ownVideoName, parseChannelRef, pathInside } from '@jgtube/core';
import { randomUUID } from 'node:crypto';
import { mkdir, open, rename, rm } from 'node:fs/promises';
import { z } from 'zod';
import type { AnalysisTracker } from './analysisRoutes';
import type { AppOptions } from './app';
import type { BreakdownOutcome, BreakdownProgress } from './breakdownTypes';
import { isWholeMp4 } from './engines/mp4';
import { ENGINE_IDS } from './engines/settings';
import { isVideoId } from './engines/videoId';
import { fail, isCrossSite, ok, readJson } from './http';
import { cleanMessage, type JobStore } from './jobs';

const MAX_CHANNEL_LENGTH = 200;
/** The one kind of file taken: the kind the engine that watches is known to open. */
const VIDEO_TYPE = 'video/mp4';
const BYTES_PER_MB = 1_000_000;

/** Breakdowns as jobs: each reports its steps and leaves its outcome to be read. */
export type BreakdownJobs = JobStore<BreakdownOutcome, BreakdownProgress>;

/** Whether a video file is being sent; one at a time. */
export interface UploadTracker {
  busy: boolean;
}

const breakdownRequest = z.object({
  channel: z.string().min(1).max(MAX_CHANNEL_LENGTH),
  // The owner's choice of one engine for the frame studies and the writing.
  engine: z.enum(ENGINE_IDS).optional(),
  // Make the watch notes and frame studies again instead of reusing stored ones.
  fresh: z.boolean().optional(),
});

function isChannel(text: string): boolean {
  try {
    parseChannelRef(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Starts a breakdown of one channel as a job and answers with its id; the
 * job's steps and its outcome are read at `/api/jobs/:id`. A breakdown and an
 * analysis each keep an AI engine busy for minutes, so one of either runs at
 * a time. The channel is checked here so that nothing but a handle, link or
 * id is passed on.
 */
export async function startBreakdown(
  options: AppOptions,
  request: Request,
  jobs: BreakdownJobs,
  tracker: AnalysisTracker,
): Promise<Response> {
  const body = await readJson(options.allowedHosts, request);
  if (body instanceof Response) return body;
  const parsed = breakdownRequest.safeParse(body);
  if (!parsed.success || !isChannel(parsed.data.channel)) {
    return fail(400, 'Give the channel to break down: a handle, a channel link or a channel id');
  }
  if (tracker.running) {
    return fail(409, 'A breakdown or an analysis is already running. Wait for it to finish.');
  }
  const { channel, engine: only, fresh } = parsed.data;
  tracker.running = true;
  const job = jobs.start((report) =>
    options.engine.breakDown(channel, report, { only, fresh }).finally(() => {
      tracker.running = false;
    }),
  );
  if (!job) {
    tracker.running = false;
    return fail(409, 'A breakdown or an analysis is already running. Wait for it to finish.');
  }
  return ok({ jobId: job.id }, 202);
}

/** Why an upload is refused before a byte of it is read, or null when it may go ahead. */
function refusalOf(options: AppOptions, request: Request, videoId: string): Response | null {
  if (isCrossSite(request, options.allowedHosts)) {
    return fail(403, 'Requests from other sites are not accepted');
  }
  if (!isVideoId(videoId)) return fail(400, 'That is not a YouTube video id.');
  if ((request.headers.get('content-type') ?? '').split(';')[0]?.trim() !== VIDEO_TYPE) {
    return fail(415, 'Only MP4 video files are taken. Choose a file that ends in .mp4.');
  }
  const announced = Number(request.headers.get('content-length') ?? '0');
  return announced > maxBytesOf(options) ? tooLarge(options) : null;
}

const maxBytesOf = (options: AppOptions): number => options.maxUploadBytes ?? MAX_OWN_VIDEO_BYTES;

const tooLarge = (options: AppOptions): Response =>
  fail(
    413,
    `That file is larger than the ${Math.round(maxBytesOf(options) / BYTES_PER_MB)} MB a video file may be.`,
  );

/** Thrown inside the write loop when the body passes the cap, so the loop's tidying still runs. */
class OverTheCap extends Error {}

/** Writes the body to a new file, stopping as soon as it passes the cap. Returns the bytes written. */
async function writeBody(
  body: ReadableStream<Uint8Array>,
  path: string,
  maxBytes: number,
): Promise<number> {
  // 'wx': the file must be new, so nothing already on disk is ever written over.
  const file = await open(path, 'wx');
  let written = 0;
  try {
    for await (const chunk of body) {
      written += chunk.byteLength;
      if (written > maxBytes) throw new OverTheCap();
      await file.write(chunk);
    }
    return written;
  } finally {
    await file.close();
  }
}

/**
 * Takes the owner's own copy of one video and saves it as
 * `my-videos/<video id>.mp4`, for a breakdown to study when the video could
 * not be downloaded. The body is streamed to a temporary name in the same
 * folder and renamed only once it has all arrived and is a whole MP4, so a
 * half-sent file is never used; whatever goes wrong, nothing is left behind.
 * The video id is checked before it touches a path.
 */
export async function uploadVideo(
  options: AppOptions,
  request: Request,
  videoId: string,
  tracker: UploadTracker,
): Promise<Response> {
  const refused = refusalOf(options, request, videoId);
  if (refused) return refused;
  if (tracker.busy) return fail(409, 'Another video file is being sent. Wait for it to finish.');
  if (request.body === null) return fail(400, 'No file was sent.');
  tracker.busy = true;
  let partial: string | null = null;
  try {
    const folder = options.engine.ownVideosFolder();
    const name = ownVideoName(videoId);
    await mkdir(folder, { recursive: true });
    partial = pathInside(folder, `${name}.part-${randomUUID()}`);
    const bytes = await writeBody(request.body, partial, maxBytesOf(options));
    if (bytes === 0) return fail(400, 'No file was sent.');
    if (!(await isWholeMp4(partial))) {
      return fail(
        400,
        'That file is not a complete MP4 video. It may have been cut short, or be another kind of file.',
      );
    }
    await rename(partial, pathInside(folder, name));
    partial = null;
    return ok({ video: videoId, bytes, file: name, folder }, 201);
  } catch (error) {
    if (error instanceof OverTheCap) return tooLarge(options);
    return fail(400, `The file did not arrive whole: ${cleanMessage(error)}`);
  } finally {
    if (partial !== null) await rm(partial, { force: true }).catch(() => undefined);
    tracker.busy = false;
  }
}
