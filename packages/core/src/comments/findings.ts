import { readBlocks, single } from '../labelled';

/**
 * "What viewers ask for", as an engine answers it: findings, each a kind, one
 * line and the comments it rests on by id. Code keeps only ids it handed out
 * and a finding that rests on enough of them; the page shows the stored
 * comment for each id, never the engine's quoting of it.
 */

export const FINDING_KINDS = ['request', 'question', 'objection'] as const;
export type FindingKind = (typeof FINDING_KINDS)[number];

/** A recurring request needs at least two comments that make it. */
export const FINDING_MIN_QUOTES = 2;
/** The most comments shown for one finding. */
export const FINDING_MAX_QUOTES = 3;
const MAX_SAYS_CHARS = 300;
const MAX_FINDINGS = 12;
const LABELS = ['KIND', 'SAYS', 'COMMENTS'] as const;
const OPENS = /^FINDING\b/i;

export interface ViewerFinding {
  readonly kind: FindingKind;
  readonly says: string;
  readonly commentIds: readonly string[];
}

const kindOf = (text: string | null): FindingKind | null =>
  FINDING_KINDS.find((kind) => kind === text?.trim().toLowerCase()) ?? null;

export function parseViewerFindings(answer: string): {
  readonly findings: readonly ViewerFinding[];
  readonly unread: number;
} {
  const blocks = readBlocks(answer, { labels: LABELS, opens: (line) => OPENS.test(line) });
  const findings = blocks.flatMap((block): ViewerFinding[] => {
    const kind = kindOf(single(block, 'KIND'));
    const says = single(block, 'SAYS');
    const ids = (single(block, 'COMMENTS') ?? '').split(/[\s,]+/).filter(Boolean);
    if (kind === null || says === null || says.length > MAX_SAYS_CHARS || ids.length === 0)
      return [];
    return [{ kind, says, commentIds: ids }];
  });
  return { findings: findings.slice(0, MAX_FINDINGS), unread: blocks.length - findings.length };
}

/** Keeps the ids that were handed out, and the findings left with enough of them. */
export function verifyFindings(
  findings: readonly ViewerFinding[],
  sent: ReadonlySet<string>,
): { readonly kept: readonly ViewerFinding[]; readonly dropped: number } {
  const checked = findings.map((finding) => ({
    ...finding,
    commentIds: [...new Set(finding.commentIds.filter((id) => sent.has(id)))].slice(
      0,
      FINDING_MAX_QUOTES,
    ),
  }));
  const kept = checked.filter((finding) => finding.commentIds.length >= FINDING_MIN_QUOTES);
  return { kept, dropped: findings.length - kept.length };
}
