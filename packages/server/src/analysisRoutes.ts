import { parseChannelRef } from '@jgtube/core';
import { z } from 'zod';
import { ANALYSIS_IDS } from './analyses';
import type { AppOptions } from './app';
import { ClaudeRunError, type ClaudeFailure } from './claudeRunner';
import { fail, ok, readJson } from './http';
import { cleanMessage } from './jobs';

const MAX_CHANNEL_LENGTH = 200;

/** Whether Claude is working on an analysis; one runs at a time. */
export interface AnalysisTracker {
  running: boolean;
}

const analysisRequest = z.object({
  analysis: z.enum(ANALYSIS_IDS),
  channel: z.string().min(1).max(MAX_CHANNEL_LENGTH),
});

/** The HTTP status that best tells a client what kind of failure it was. */
const STATUS: Readonly<Record<ClaudeFailure, number>> = {
  'not-installed': 503,
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
 * Asks Claude one of the fixed analyses about a channel and waits for the
 * answer, which takes up to a few minutes. The channel is checked here so that
 * nothing but a handle, link or id can reach the question put to Claude.
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
    return fail(400, `Name an analysis (${ANALYSIS_IDS.join(', ')}) and a channel`);
  }
  if (tracker.running) {
    return fail(409, 'Claude is already working on an analysis. Wait for it to finish.');
  }

  tracker.running = true;
  try {
    const { analysis, channel } = parsed.data;
    const { text } = await options.engine.analyse(analysis, channel);
    return ok({ analysis, text });
  } catch (error) {
    return error instanceof ClaudeRunError
      ? fail(STATUS[error.reason], error.message)
      : fail(502, `The analysis did not finish: ${cleanMessage(error)}`);
  } finally {
    tracker.running = false;
  }
}
