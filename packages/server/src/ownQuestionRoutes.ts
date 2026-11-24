import { parseChannelRef } from '@jgtube/core';
import { z } from 'zod';
import type { AnalysisTracker } from './analysisRoutes';
import { STATUS } from './analysisRoutes';
import type { AppOptions } from './app';
import { EngineRunError } from './engines/failure';
import { ENGINE_IDS } from './engines/settings';
import { fail, ok, readJson } from './http';
import { channelLabel } from './jobLabels';
import { holdRun } from './jobList';
import { cleanMessage } from './jobs';
import {
  MAX_QUESTION_CHARS,
  OWN_QUESTION_ID,
  questionProblem,
  questionSubjectOf,
  type OwnQuestionFocus,
} from './ownQuestion';

/** Where the owner's own question is asked, and its last answer read. */
export const OWN_QUESTION_PATH = '/api/analyses/question';

const MAX_CHANNEL_LENGTH = 200;
const CHANNEL_ID = /^UC[\w-]{22}$/;
const VIDEO_ID = /^[\w-]{11}$/;

const askRequest = z.object({
  channel: z.string().min(1).max(MAX_CHANNEL_LENGTH),
  // A little room over the cap, so a long question gets the plain words of questionProblem.
  question: z.string().max(MAX_QUESTION_CHARS * 2),
  engine: z.enum(ENGINE_IDS).optional(),
  // What was on screen while asking: ids only, checked again where the prompt is written.
  about: z
    .object({
      channelId: z.string().regex(CHANNEL_ID).optional(),
      videoId: z.string().regex(VIDEO_ID).optional(),
    })
    .optional(),
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
 * Puts the owner's own question about a channel to an AI engine, with the
 * map's read-only tools, and keeps the answer with the question. One AI run
 * at a time, shared with the quick analyses, and listed as work under way.
 */
export async function askOwnQuestion(
  options: AppOptions,
  request: Request,
  tracker: AnalysisTracker,
): Promise<Response> {
  const body = await readJson(options.allowedHosts, request);
  if (body instanceof Response) return body;
  const parsed = askRequest.safeParse(body);
  if (!parsed.success || !isChannel(parsed.data.channel)) {
    return fail(400, 'Give a channel and a question of one line');
  }
  const { channel, question, engine: only, about } = parsed.data;
  const problem = questionProblem(question);
  if (problem) return fail(400, problem);
  if (tracker.running) return fail(409, 'An analysis is already running. Wait for it to finish.');

  tracker.running = true;
  try {
    const label = channelLabel(options.engine, 'analysis', 'Your question about', channel);
    const subject = questionSubjectOf(about);
    const focus: OwnQuestionFocus = {
      kind: OWN_QUESTION_ID,
      text: question.trim(),
      ...(subject ? { subject } : {}),
    };
    const { text, engine, skipped } = await holdRun(
      tracker.held,
      label,
      options.engine.analyse(OWN_QUESTION_ID, channel, only, focus),
    );
    const kept = options.engine.keepOwnAnswer(channel, focus.text, { text, engine });
    return ok({
      channelId: kept?.channelId ?? null,
      question: focus.text,
      text: kept?.text ?? text,
      engine,
      writtenAt: kept?.writtenAt ?? null,
      skipped,
    });
  } catch (error) {
    return error instanceof EngineRunError
      ? fail(STATUS[error.reason], error.message)
      : fail(502, `The question was not answered: ${cleanMessage(error)}`);
  } finally {
    tracker.running = false;
  }
}

/** The owner's last own question for a channel and its answer; none is a normal reply. */
export function readOwnAnswer(options: AppOptions, url: URL): Response {
  const channel = url.searchParams.get('channel') ?? '';
  if (!CHANNEL_ID.test(channel)) return fail(400, 'Give the channel as a channel id');
  return ok({ answer: options.engine.findOwnAnswer(channel) });
}
