import { readBlocks, single, type LabelledBlock } from '../labelled';

/**
 * A risk check's answer, as an engine writes it: title or thumbnail claims
 * the script does not support, each quoting both, and a short note on each
 * overlap Jgtube found. Code keeps a claim only when both quotes are really
 * there, and a note only on an overlap it found itself.
 */

export const CLAIM_PLACES = ['title', 'alt-title', 'thumbnail', 'overlay'] as const;
export type ClaimPlace = (typeof CLAIM_PLACES)[number];

const PLACE_WORDS: Readonly<Record<string, ClaimPlace>> = {
  title: 'title',
  'alternate title': 'alt-title',
  'alt title': 'alt-title',
  'alt-title': 'alt-title',
  thumbnail: 'thumbnail',
  overlay: 'overlay',
};
const MAX_TEXT = 400;
const MAX_CLAIMS = 12;
const NONE = /^none\.?$/i;

export interface RiskClaim {
  readonly where: ClaimPlace;
  /** The claim's words, as quoted. */
  readonly says: string;
  /** The script's nearest words on it; null when the script says nothing on it. */
  readonly script: string | null;
  readonly why: string;
}

export interface OverlapNote {
  readonly id: string;
  readonly note: string;
}

export interface RiskAnswer {
  readonly claims: readonly RiskClaim[];
  readonly notes: readonly OverlapNote[];
}

const short = (text: string | null): string | null =>
  text !== null && text.length <= MAX_TEXT ? text : null;

function claimOf(block: LabelledBlock): RiskClaim | null {
  const where = PLACE_WORDS[(single(block, 'WHERE') ?? '').trim().toLowerCase()];
  const says = short(single(block, 'SAYS'));
  const quoted = short(single(block, 'SCRIPT'));
  const why = short(single(block, 'WHY'));
  if (!where || says === null || quoted === null || why === null) return null;
  return { where, says, script: NONE.test(quoted.trim()) ? null : quoted, why };
}

function noteOf(block: LabelledBlock): OverlapNote | null {
  const id = single(block, 'ID')?.trim().toLowerCase() ?? null;
  const note = short(single(block, 'NOTE'));
  return id !== null && /^o\d+$/.test(id) && note !== null ? { id, note } : null;
}

export function parseRiskAnswer(answer: string): RiskAnswer & { readonly unread: number } {
  const blocks = readBlocks(answer, {
    labels: ['WHERE', 'SAYS', 'SCRIPT', 'WHY', 'ID', 'NOTE'],
    opens: (line) => /^(CLAIM|OVERLAP)\b/i.test(line),
  });
  const claims = blocks.flatMap((block) => (block.has('ID') ? [] : (claimOf(block) ?? [])));
  const notes = blocks.flatMap((block) => (block.has('ID') ? (noteOf(block) ?? []) : []));
  return {
    claims: claims.slice(0, MAX_CLAIMS),
    notes,
    unread: blocks.length - claims.length - notes.length,
  };
}

/** Text as it is compared: one case, one kind of quote mark, single spaces. */
const plain = (text: string): string =>
  text.toLowerCase().replace(/[‘’`]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim();

export interface Packaging {
  readonly title: string;
  readonly altTitles: readonly string[];
  readonly thumbnail: string;
  readonly overlay: string;
}

const placeText = (packaging: Packaging, where: ClaimPlace): readonly string[] =>
  where === 'title'
    ? [packaging.title]
    : where === 'alt-title'
      ? packaging.altTitles
      : [where === 'thumbnail' ? packaging.thumbnail : packaging.overlay];

export function verifyRiskAnswer(
  answer: RiskAnswer,
  against: {
    readonly packaging: Packaging;
    readonly script: string;
    readonly overlapIds: ReadonlySet<string>;
  },
): RiskAnswer & { readonly dropped: number } {
  const script = plain(against.script);
  const claims = answer.claims.filter(
    (claim) =>
      placeText(against.packaging, claim.where).some((text) =>
        plain(text).includes(plain(claim.says)),
      ) &&
      (claim.script === null || script.includes(plain(claim.script))),
  );
  const notes = answer.notes.filter((note) => against.overlapIds.has(note.id));
  return {
    claims,
    notes,
    dropped: answer.claims.length - claims.length + answer.notes.length - notes.length,
  };
}
