/**
 * Runs the picture check on one engine and keeps the result: two pictures of
 * random colours in, the colour names out, checked in code. See
 * `pictureCheck.ts` for why it hands files and how likely a guess is to pass.
 */
import { TOOL_PICTURE_ENGINES } from './analyses';
import { EngineRunError } from './engines/failure';
import type { EngineId, EngineRunRequest, EngineRunResult } from './engines/types';
import { checkPictureAnswer, pickColours, pictureCheckRequest } from './pictureCheck';
import { MAX_ANSWER_LENGTH, type PictureCheckRecord, type PictureChecks } from './pictureChecks';

export interface PictureCheckDeps {
  readonly run: (engine: EngineId, request: EngineRunRequest) => Promise<EngineRunResult>;
  /** The engine's own private folder, where the run's folder is made. */
  readonly workDir: (engine: EngineId) => string;
  readonly checks: PictureChecks;
  /** The engines the owner's settings let Jgtube use. */
  readonly order: () => readonly EngineId[];
  readonly now: () => Date;
  readonly random?: () => number;
}

/** The answer as kept and shown: one line, cut to a length a person reads at a glance. */
const shortAnswer = (text: string): string =>
  text.replace(/\s+/g, ' ').trim().slice(0, MAX_ANSWER_LENGTH);

/**
 * Checks that `engine` sees the pictures it is handed, and keeps the result.
 * Rejects, keeping nothing, for an engine that needs no check, one the
 * settings leave out, or a run that failed (the earlier result then stands).
 */
export async function runPictureCheck(
  engine: EngineId,
  deps: PictureCheckDeps,
): Promise<PictureCheckRecord> {
  if (TOOL_PICTURE_ENGINES.includes(engine)) {
    throw new EngineRunError('failed', 'This engine is already known to see pictures.');
  }
  if (!deps.order().includes(engine)) {
    throw new EngineRunError(
      'not-installed',
      'This engine is left out by the JGTUBE_ENGINES setting.',
    );
  }
  const shown = pickColours(deps.random);
  const reply = await deps.run(
    engine,
    pictureCheckRequest(shown, { workDir: deps.workDir(engine) }),
  );
  const record: PictureCheckRecord = {
    engine,
    passed: checkPictureAnswer(reply.text, shown),
    answer: shortAnswer(reply.text),
    shown: shown.map((colour) => colour.name),
    checkedAt: deps.now().toISOString(),
  };
  deps.checks.record(record);
  return record;
}
