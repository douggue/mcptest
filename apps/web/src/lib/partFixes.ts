/**
 * What the page offers for one part of a stored breakdown that is not as it
 * should be: a part that was not written gets "Write this part", which writes
 * that part again and then the parts built on it (the strategy, the plan and
 * the master prompt), so none is left out of date; a part written from pictures it names none of gets a
 * warning and the offer to write it again on another AI.
 */
import { engineName } from './breakdown';
import type { BreakdownPartView, BreakdownWrittenPart } from './breakdownParts';

/** A run of the breakdown that writes chosen parts only, from what is stored. */
export interface PartsRun {
  readonly parts: readonly BreakdownWrittenPart[];
  /** An AI to leave out this time; null for none. */
  readonly avoid: string | null;
}

export interface PartRerun extends PartsRun {
  readonly label: string;
}

export interface PartFixes {
  /** A warning to show beside the part; null when there is none. */
  readonly warning: string | null;
  /** The button to offer; null when there is none. */
  readonly action: PartRerun | null;
}

const NOTHING: PartFixes = { warning: null, action: null };

/** What to offer for one part. */
export function partFixes(part: BreakdownPartView): PartFixes {
  if (part.id === 'basis') return NOTHING;
  const id: BreakdownWrittenPart = part.id;
  if (part.state !== 'written') {
    return { warning: null, action: { label: 'Write this part', parts: [id], avoid: null } };
  }
  if (part.unseen !== true || part.engine === null) return NOTHING;
  return {
    warning: `${engineName(part.engine)} may not have seen the pictures: its answer names none of the picture files it was given.`,
    action: { label: 'Write it again on another AI', parts: [id], avoid: part.engine },
  };
}
