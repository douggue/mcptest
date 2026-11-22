/**
 * Tries engines in order and takes the first answer.
 *
 * Whatever stops an engine (not installed, not signed in, out of allowance,
 * too slow, or an error of its own), the next one is tried. The others are
 * there as backups, and an engine that hangs or cannot read its own reply
 * says nothing about whether the next can answer. The one exception is
 * Jgtube closing, which ends the whole attempt.
 */
import { cleanMessage } from '../jobs';
import { EngineRunError, type SkippedEngine } from './failure';
import type { AnyEngineId, EngineFailure, EngineRunResult } from './types';

/** When no engine answered, the failure reported is the first of these that occurred. */
const MOST_TELLING: readonly EngineFailure[] = [
  'limit',
  'not-signed-in',
  'timeout',
  'failed',
  'not-installed',
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
  /** The engine the owner chose, when another wrote the answer because it could not, and why. */
  readonly standInFor?: { readonly engine: Id; readonly because: string };
  /** Pictures handed over as files: how many there were, and how many the answer names. */
  readonly seen?: { readonly shown: number; readonly named: number };
}

function nobodyCould(explanation: string, skipped: readonly SkippedEngine[]): EngineRunError {
  const reasons = skipped.map((entry) => entry.reason);
  const reason = MOST_TELLING.find((kind) => reasons.includes(kind)) ?? 'not-installed';
  const details = skipped.map((entry) => entry.message).join(' ');
  return new EngineRunError(reason, details ? `${explanation} ${details}` : explanation, skipped);
}

/** Any error as an engine's failure: one that is not already is a plain failure, safely worded. */
const asFailure = (error: unknown): EngineRunError =>
  error instanceof EngineRunError
    ? error
    : new EngineRunError('failed', `It stopped with an error of its own: ${cleanMessage(error)}`);

/** An engine to try, or one already ruled out with the reason. */
export type Candidate<Id extends AnyEngineId> = Attempt<Id> | SkippedEngine;

const isAttempt = <Id extends AnyEngineId>(candidate: Candidate<Id>): candidate is Attempt<Id> =>
  'run' in candidate;

/**
 * The first answer among the candidates, in order. A candidate that is
 * already ruled out, or that fails, is noted as passed over. Rejects with an
 * EngineRunError that carries the engines passed over: `nobody` with each
 * engine's reason when none answered, or the failure itself once `stopped`
 * says Jgtube is closing.
 */
export async function firstAnswer<Id extends AnyEngineId>(
  candidates: ReadonlyArray<Candidate<Id>>,
  nobody: string,
  stopped: () => boolean = () => false,
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
      const failure = asFailure(error);
      if (stopped()) throw new EngineRunError(failure.reason, failure.message, skipped);
      const { engine } = candidate;
      skipped = [...skipped, { engine, reason: failure.reason, message: failure.message }];
    }
  }
  throw nobodyCould(nobody, skipped);
}
