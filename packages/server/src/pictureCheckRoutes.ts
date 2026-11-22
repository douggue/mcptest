import { z } from 'zod';
import { PICTURE_ENGINES } from './analyses';
import { STATUS, type AnalysisTracker } from './analysisRoutes';
import type { AppOptions } from './app';
import { EngineRunError } from './engines/failure';
import { ENGINE_IDS } from './engines/settings';
import { fail, ok, readJson } from './http';
import { holdRun } from './jobList';
import { cleanMessage } from './jobs';

export const PICTURE_CHECK_PATH = '/api/engines/picture-check';

const checkRequest = z.object({ engine: z.enum(ENGINE_IDS) });

/**
 * Runs the picture check on one engine (`{ engine }`) and returns the result
 * as kept: whether it saw the pictures, its answer and the colours shown.
 * Only an engine not already known to see pictures is checked, one run at a
 * time with the analyses, since each spends a little of the owner's allowance.
 */
export async function runPictureCheckRoute(
  options: AppOptions,
  request: Request,
  tracker: AnalysisTracker,
): Promise<Response> {
  const body = await readJson(options.allowedHosts, request);
  if (body instanceof Response) return body;
  const parsed = checkRequest.safeParse(body);
  if (!parsed.success) return fail(400, `Name an engine (${ENGINE_IDS.join(', ')})`);
  const { engine } = parsed.data;
  if (PICTURE_ENGINES.includes(engine)) {
    return fail(400, 'That engine is already known to see pictures; it needs no check.');
  }
  if (tracker.running) return fail(409, 'An AI is already working. Wait for it to finish.');

  tracker.running = true;
  try {
    const label = { kind: 'picture-check', title: 'Checking an AI can see pictures', engine };
    return ok(await holdRun(tracker.held, label, options.engine.checkPictures(engine)));
  } catch (error) {
    return error instanceof EngineRunError
      ? fail(STATUS[error.reason], error.message)
      : fail(502, `The picture check did not finish: ${cleanMessage(error)}`);
  } finally {
    tracker.running = false;
  }
}
