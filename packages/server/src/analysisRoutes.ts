import { parseChannelRef } from '@jgtube/core';
import { z } from 'zod';
import { QUICK_ANALYSIS_IDS } from './analyses';
import type { AppOptions } from './app';
import { EngineRunError } from './engines/failure';
import { ENGINE_IDS } from './engines/settings';
import type { EngineFailure } from './engines/types';
import { fail, ok, readJson } from './http';
import { cleanMessage } from './jobs';

const MAX_CHANNEL_LENGTH = 200;

/** Whether an AI engine is working on an analysis; one runs at a time. */
export interface AnalysisTracker {
  running: boolean;
}

const analysisRequest = z.object({
  analysis: z.enum(QUICK_ANALYSIS_IDS),
  channel: z.string().min(1).max(MAX_CHANNEL_LENGTH),
  // The owner's choice of one engine for this run; left out, the usual order with its backups.
  engine: z.enum(ENGINE_IDS).optional(),
});

/** The HTTP status that best tells a client what kind of failure it was. */
export const STATUS: Readonly<Record<EngineFailure, number>> = {
  'not-installed': 503,
  'not-signed-in': 503,
  limit: 429,
  timeout: 504,
  failed: 502,
};

function isChannel(text: string): boolean {
  try {
    parseChannelRef(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Puts one of the fixed analyses about a channel to an AI engine and waits for
 * the answer, which takes up to a few minutes. The channel is checked here so
 * that nothing but a handle, link or id can reach the question. The request
 * may name the one engine to use. The reply names the engine that answered
 * and the ones passed over, with the reason.
 */
export async function runAnalysis(
  options: AppOptions,
  request: Request,
  tracker: AnalysisTracker,
): Promise<Response> {
  const body = await readJson(options.allowedHosts, request);
  if (body instanceof Response) return body;
  const parsed = analysisRequest.safeParse(body);
  if (!parsed.success || !isChannel(parsed.data.channel)) {
    return fail(400, `Name an analysis (${QUICK_ANALYSIS_IDS.join(', ')}) and a channel`);
  }
  if (tracker.running) {
    return fail(409, 'An analysis is already running. Wait for it to finish.');
  }

  tracker.running = true;
  try {
    const { analysis, channel, engine: only } = parsed.data;
    const { text, engine, skipped } = await options.engine.analyse(analysis, channel, only);
    // Kept for the channel, so it can be read again and a later question can read it
    // through a tool. A channel that is not stored has nowhere to keep it.
    const kept = options.engine.keepAnswer(analysis, channel, { text, engine });
    return ok({
      analysis,
      text: kept?.text ?? text,
      prompt: kept?.prompt ?? null,
      videos: kept?.videos ?? [],
      writtenAt: kept?.writtenAt ?? null,
      engine,
      skipped,
    });
  } catch (error) {
    return error instanceof EngineRunError
      ? fail(STATUS[error.reason], error.message)
      : fail(502, `The analysis did not finish: ${cleanMessage(error)}`);
  } finally {
    tracker.running = false;
  }
}

/**
 * Which AI engines are installed and signed in on this computer, and the
 * order they are tried in. Asks each program only about itself.
 */
export async function readEngines(options: AppOptions): Promise<Response> {
  try {
    return ok(await options.engine.engineStatus());
  } catch (error) {
    return fail(502, `The engines could not be checked: ${cleanMessage(error)}`);
  }
}
