/**
 * The writing of a breakdown: its seven parts, one engine run each, in
 * order. What Jgtube worked out itself (the basis) is stored first. Each
 * part is stored as soon as it is written; a part that fails is stored with
 * its reason and the rest still run where they can.
 *
 * A stored part is kept, and not written again, only while the facts it was
 * written from are the same: the basis is word for word what it was, the
 * owner did not ask to start from nothing, and no part it reads was written
 * again in this run.
 */
import {
  BREAKDOWN_BASIS_PART,
  BREAKDOWN_WRITTEN_PARTS,
  type BreakdownCaveat,
  type BreakdownRepo,
  type BreakdownWrittenPart,
} from '@jgtube/core';
import { partProgress, partsBuiltOn, type BreakdownFocus } from './breakdownParts';
import type { BreakdownChoices, PartRun } from './breakdownTypes';
import type { EngineAnswer } from './engines/fallback';
import type { EngineId } from './engines/types';
import { cleanMessage } from './jobs';
import { CLOSING } from './running';

/** Who wrote the basis: Jgtube itself, in code. */
export const BASIS_WRITER = 'jgtube';
const NOTHING_TO_BUILD_ON =
  'It is built from earlier parts of the breakdown, and none of those was written.';
const SECOND_MS = 1000;

export interface WritingDeps {
  readonly now: () => Date;
  /** Aborted when Jgtube is closing. */
  readonly stop: AbortSignal;
  readonly parts: BreakdownRepo;
  /** A clock that only moves forward, in milliseconds, to time each run. */
  readonly tick: () => number;
  write(
    part: BreakdownWrittenPart,
    channel: string,
    only: EngineId | undefined,
    focus: BreakdownFocus,
    avoid?: EngineId,
  ): Promise<EngineAnswer<EngineId>>;
}

export interface WritingInput {
  readonly channelId: string;
  readonly focus: BreakdownFocus;
  /** What the breakdown rests on, worked out in code. */
  readonly basis: string;
  readonly choices: BreakdownChoices;
  /** Says the step in plain words. */
  readonly say: (text: string) => void;
}

const sentence = (text: string): string => `${text.trim().replace(/\.$/, '')}.`;

/** Stores the basis and says whether it is word for word what was stored before. */
function storeBasis(deps: WritingDeps, { channelId, basis }: WritingInput): boolean {
  const stored = deps.parts.find(channelId, BREAKDOWN_BASIS_PART);
  const same = stored?.written === true && stored.text === basis;
  if (!same) {
    deps.parts.saveWritten(
      { channelId, part: BREAKDOWN_BASIS_PART, engine: BASIS_WRITER, text: basis },
      deps.now(),
    );
  }
  return same;
}

/** What a reader should know about how an answer was written; undefined when nothing. */
function caveatOf(answer: EngineAnswer<EngineId>): BreakdownCaveat | undefined {
  const unseen = answer.seen !== undefined && answer.seen.shown > 0 && answer.seen.named === 0;
  if (answer.standInFor === undefined && !unseen) return undefined;
  return {
    ...(answer.standInFor ? { standInFor: answer.standInFor } : {}),
    ...(unseen && answer.seen ? { unseen: { shown: answer.seen.shown } } : {}),
  };
}

/** Has an engine write one part and stores it, or stores why it could not be written. */
async function writeOne(
  deps: WritingDeps,
  input: WritingInput,
  part: BreakdownWrittenPart,
): Promise<PartRun> {
  const { channelId, choices, focus } = input;
  const started = deps.tick();
  const seconds = (): number => Math.round((deps.tick() - started) / SECOND_MS);
  try {
    const answer = await deps.write(part, channelId, choices.only, focus, choices.avoid);
    const caveat = caveatOf(answer);
    deps.parts.saveWritten(
      { channelId, part, engine: answer.engine, text: answer.text, ...(caveat ? { caveat } : {}) },
      deps.now(),
    );
    return {
      part,
      outcome: 'written',
      engine: answer.engine,
      skipped: answer.skipped,
      seconds: seconds(),
      ...(caveat?.standInFor ? { standInFor: caveat.standInFor } : {}),
      ...(caveat?.unseen ? { unseen: true } : {}),
    };
  } catch (error) {
    if (deps.stop.aborted) throw new Error(CLOSING, { cause: error });
    const reason = sentence(cleanMessage(error));
    deps.parts.saveFailed({ channelId, part, reason }, deps.now());
    return { part, outcome: 'failed', reason, seconds: seconds() };
  }
}

/** A part not chosen to be written again: kept when it is written, else as it failed. */
function leftAsItIs(
  part: BreakdownWrittenPart,
  stored: ReturnType<BreakdownRepo['find']>,
): PartRun {
  if (stored?.written === true) return { part, outcome: 'kept', engine: stored.engine, seconds: 0 };
  const reason = stored?.written === false ? stored.reason : 'It has not been written yet.';
  return { part, outcome: 'failed', reason, seconds: 0 };
}

/**
 * Writes the parts of one channel's breakdown that need writing, in order,
 * and says how each went. Rejects only when Jgtube is closing.
 */
export async function writeParts(
  deps: WritingDeps,
  input: WritingInput,
): Promise<readonly PartRun[]> {
  const { channelId, choices } = input;
  // Writing chosen parts again leaves the basis as it was: it was not worked out afresh.
  const chosen = choices.parts;
  const unchanged = chosen === undefined ? storeBasis(deps, input) && choices.fresh !== true : true;
  let rewritten: readonly BreakdownWrittenPart[] = [];
  let runs: readonly PartRun[] = [];
  for (const part of BREAKDOWN_WRITTEN_PARTS) {
    if (deps.stop.aborted) throw new Error(CLOSING);
    const stored = deps.parts.find(channelId, part);
    const builtOn = partsBuiltOn(part);
    // A part that reads one written again in this run is out of date: the
    // master prompt, the plan and the strategy follow the parts they rest on.
    const stale = builtOn.some((earlier) => rewritten.includes(earlier));
    if (chosen !== undefined && !chosen.includes(part) && !stale) {
      runs = [...runs, leftAsItIs(part, stored)];
      continue;
    }
    if (chosen === undefined && unchanged && stored?.written === true && !stale) {
      runs = [...runs, { part, outcome: 'kept', engine: stored.engine, seconds: 0 }];
      continue;
    }
    const has = builtOn.some((earlier) => deps.parts.find(channelId, earlier)?.written === true);
    if (builtOn.length > 0 && !has) {
      deps.parts.saveFailed({ channelId, part, reason: NOTHING_TO_BUILD_ON }, deps.now());
      runs = [...runs, { part, outcome: 'failed', reason: NOTHING_TO_BUILD_ON, seconds: 0 }];
      continue;
    }
    input.say(partProgress(part));
    const run = await writeOne(deps, input, part);
    if (run.outcome === 'written') rewritten = [...rewritten, part];
    runs = [...runs, run];
  }
  return runs;
}
