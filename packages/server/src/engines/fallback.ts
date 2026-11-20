/**
 * Tries engines in order and takes the first answer.
 *
 * An engine that is not installed, not signed in, or out of allowance is
 * passed over and the next one is tried. An engine that ran and failed, or
 * ran out of time, is not: trying the same question on the next engine would
 * spend a second plan's allowance on what is probably the same problem, so
 * that failure is reported as it is.
 */
import { EngineRunError, type SkippedEngine } from './failure';
import type { AnyEngineId, EngineFailure, EngineRunResult } from './types';

/** The failures after which the next engine is tried. */
export const MOVE_ON: readonly EngineFailure[] = ['not-installed', 'not-signed-in', 'limit'];
/** When every engine was passed over, the failure reported is the first of these that occurred. */
const MOST_TELLING: readonly EngineFailure[] = [
  'limit',
  'not-signed-in',
  'not-installed',
  'failed',
];

export interface Attempt<Id extends AnyEngineId> {
  readonly engine: Id;
  readonly run: () => Promise<EngineRunResult>;
}

export interface EngineAnswer<Id extends AnyEngineId> extends EngineRunResult {
  /** The engine that produced the answer. */
  readonly engine: Id;
  /** The engines passed over on the way, and why. */
  readonly skipped: readonly SkippedEngine[];
}

function nobodyCould(explanation: string, skipped: readonly SkippedEngine[]): EngineRunError {
  const reasons = skipped.map((entry) => entry.reason);
  const reason = MOST_TELLING.find((kind) => reasons.includes(kind)) ?? 'not-installed';
  const details = skipped.map((entry) => entry.message).join(' ');
  return new EngineRunError(reason, details ? `${explanation} ${details}` : explanation, skipped);
}

/** An engine to try, or one already ruled out with the reason. */
export type Candidate<Id extends AnyEngineId> = Attempt<Id> | SkippedEngine;

const isAttempt = <Id extends AnyEngineId>(candidate: Candidate<Id>): candidate is Attempt<Id> =>
  'run' in candidate;

/**
 * The first answer among the candidates, in order. A candidate that is
 * already ruled out is noted as passed over when its turn comes. Rejects with
 * an EngineRunError that carries the engines passed over: the failure of the
 * engine that ran, or `nobody` with each engine's reason when none could.
 */
export async function firstAnswer<Id extends AnyEngineId>(
  candidates: ReadonlyArray<Candidate<Id>>,
  nobody: string,
): Promise<EngineAnswer<Id>> {
  let skipped: readonly SkippedEngine[] = [];
  for (const candidate of candidates) {
    if (!isAttempt(candidate)) {
      skipped = [...skipped, candidate];
      continue;
    }
    try {
      return { ...(await candidate.run()), engine: candidate.engine, skipped };
    } catch (error) {
      if (!(error instanceof EngineRunError)) throw error;
      if (!MOVE_ON.includes(error.reason)) {
        throw new EngineRunError(error.reason, error.message, skipped);
      }
      const { engine } = candidate;
      skipped = [...skipped, { engine, reason: error.reason, message: error.message }];
    }
  }
  throw nobodyCould(nobody, skipped);
}
