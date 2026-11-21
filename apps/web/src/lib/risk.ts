import type { CheckMarker, ClaimPlace, Overlap, OverlapNote, RiskClaim } from '@jgtube/core';
import { since, span } from './changes';

/** The risk check of one script, as the server answers it. Times are ISO-8601. */
export interface RiskAiView {
  readonly claims: readonly RiskClaim[];
  readonly notes: readonly OverlapNote[];
  readonly engine: string;
  readonly checkedAt: string;
  readonly scriptChangedSince: boolean;
}

export interface RiskCheckView {
  readonly conceptId: number;
  readonly title: string;
  readonly stage: 'tightened' | 'draft';
  readonly overlaps: readonly Overlap[];
  readonly transcriptsCompared: number;
  readonly unchecked: readonly CheckMarker[];
  readonly ai: RiskAiView | null;
}

export interface RiskView {
  readonly centerChannelId: string;
  readonly concepts: readonly { readonly conceptId: number; readonly title: string }[];
  readonly check: RiskCheckView | null;
}

export const NOT_A_VERDICT =
  'A list of things to look at before you publish. It is not legal advice, and it says nothing about whether YouTube’s rules allow anything.';

export const PLACE_LABELS: Readonly<Record<ClaimPlace, string>> = {
  title: 'Title',
  'alt-title': 'Alternate title',
  thumbnail: 'Thumbnail brief',
  overlay: 'Overlay',
};

/** What was checked, against how many stored transcripts. */
export function stageLine(stage: RiskCheckView['stage'], transcripts: number): string {
  const what = stage === 'tightened' ? 'the tightened script' : 'the draft';
  if (transcripts === 0) {
    return `Checked ${what}. No transcript of a look-alike on this map is stored, so nothing could be compared; Download transcripts stores some.`;
  }
  return `Checked ${what} against ${transcripts} stored transcript${transcripts === 1 ? '' : 's'} of look-alikes on this map.`;
}

/** One sentence that shares a long run of words with a competitor. */
export function overlapLine(overlap: Overlap): string {
  return `Shares ${overlap.words} words in a row with a stored transcript: “${overlap.phrase}”`;
}

export function uncheckedLine(count: number): string {
  if (count === 0) return 'No fact is still marked to check.';
  return `${count} fact${count === 1 ? ' is' : 's are'} still marked to check, counted in the script.`;
}

/** Who checked the claims and when, and whether the script has changed since. */
export function aiLine(ai: RiskAiView, now: Date): string {
  const line = `Claims checked by ${ai.engine} ${span(since(ai.checkedAt, now))} ago.`;
  return ai.scriptChangedSince ? `${line} The script has changed since, so check again.` : line;
}
