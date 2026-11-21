/**
 * The risk check before publishing, as the API sees it: for one kept
 * concept's script, what code finds (long runs of words shared with stored
 * competitor transcripts, facts still marked to check) and what one AI
 * question adds (title or thumbnail claims the script does not support),
 * kept only once checked in code. A list of what to look at, not a verdict.
 */
import type { CheckMarker, Overlap, OverlapNote, RiskClaim } from '@jgtube/core';
import type { EngineId } from './engines/types';

export interface RiskCheckView {
  readonly conceptId: number;
  readonly title: string;
  readonly stage: 'tightened' | 'draft';
  readonly overlaps: readonly Overlap[];
  readonly transcriptsCompared: number;
  readonly unchecked: readonly CheckMarker[];
  /** The latest AI check of this concept, as checked in code; null when none was made. */
  readonly ai: {
    readonly claims: readonly RiskClaim[];
    readonly notes: readonly OverlapNote[];
    readonly engine: string;
    /** ISO-8601. */
    readonly checkedAt: string;
    /** The script changed after that check, so it may no longer hold. */
    readonly scriptChangedSince: boolean;
  } | null;
}

export interface RiskView {
  readonly centerChannelId: string;
  /** The channel's kept concepts that have a script. */
  readonly concepts: readonly { readonly conceptId: number; readonly title: string }[];
  /** The chosen concept's check; null when none is chosen or it has no script. */
  readonly check: RiskCheckView | null;
}

/** What the connector tool hands an engine: what code found, never a verdict. */
export interface RiskToolFindings {
  readonly stage: 'tightened' | 'draft';
  readonly overlaps: readonly Overlap[];
  readonly transcriptsCompared: number;
  readonly unchecked: readonly CheckMarker[];
}

export interface RiskAskOutcome {
  /** Claims and overlap notes kept, and those dropped for quotes that were not really there. */
  readonly claims: number;
  readonly notes: number;
  readonly dropped: number;
  readonly engine: string;
}

export interface RiskEngine {
  /** Reads the store only; null when the channel has no map. */
  findRisk(centerChannelId: string, conceptId: number | null): RiskView | null;
  askRisk(centerChannelId: string, conceptId: number, only?: EngineId): Promise<RiskAskOutcome>;
  /** For the connector tool; null with no map, no kept concept or no script. */
  riskFindings(centerChannelId: string, conceptId: number): RiskToolFindings | null;
}
