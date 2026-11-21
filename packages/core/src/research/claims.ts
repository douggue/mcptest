import { checkMarkers } from '../script/measure';
import { httpsSource } from './factSheet';

/**
 * The claims check: the facts a script still marks with [CHECK: ...], sent
 * in batches to a web research run, and its verdict on each read strictly.
 * A verdict of confirmed or wrong counts only with an https source, and
 * wrong only with a correction; anything else is unsure.
 */

export const MAX_CLAIMS_PER_RUN = 10;
const MAX_TEXT_CHARS = 400;

export interface Claim {
  /** What to verify, in the marker's words. */
  readonly what: string;
  /** The sentence the marker stands in, without its markers. */
  readonly sentence: string;
}

export type Verdict = 'confirmed' | 'wrong' | 'unsure';

export interface ClaimVerdict {
  /** The claim's number in the batch, from 1. */
  readonly index: number;
  readonly verdict: Verdict;
  readonly why: string;
  /** The right statement, for a claim found wrong; else null. */
  readonly correction: string | null;
  readonly sources: readonly string[];
}

/** Every check marker of a script with its sentence, in order. */
export const claimsToCheck = (script: string): readonly Claim[] =>
  checkMarkers(script).map((marker) => ({ what: marker.what, sentence: marker.near }));

const CLAIM_LINE = /^CLAIM\s+(\d{1,2})\s*:\s*(CONFIRMED|WRONG|UNSURE)\b/i;
const FIELD_LINE = /^(WHY|CORRECTION|SOURCE)\s*:\s*(\S.*)$/i;
const MAX_SOURCES = 2;

interface Draft {
  readonly index: number;
  readonly said: Verdict;
  readonly why: string;
  readonly correction: string | null;
  readonly sources: readonly string[];
}

const cleanLine = (line: string): string => line.replace(/^[-*•\s]+|[*`]/g, '').trim();

function withField(draft: Draft, field: string, value: string): Draft {
  const text = value.trim().slice(0, MAX_TEXT_CHARS);
  if (field === 'WHY') return { ...draft, why: text };
  if (field === 'CORRECTION') return { ...draft, correction: text };
  const url = httpsSource(value);
  return url && draft.sources.length < MAX_SOURCES && !draft.sources.includes(url)
    ? { ...draft, sources: [...draft.sources, url] }
    : draft;
}

/** A verdict as it may stand: no support, no confirmed or wrong. */
function settled(draft: Draft): ClaimVerdict {
  const supported = draft.sources.length > 0;
  const verdict: Verdict =
    draft.said === 'confirmed' && supported
      ? 'confirmed'
      : draft.said === 'wrong' && supported && draft.correction
        ? 'wrong'
        : 'unsure';
  return {
    index: draft.index,
    verdict,
    why: draft.why,
    correction: verdict === 'wrong' ? draft.correction : null,
    sources: draft.sources,
  };
}

/** The verdict on each of `count` claims asked about, in order; unsure for any not answered. */
export function parseClaimVerdicts(answer: string, count: number): readonly ClaimVerdict[] {
  const drafts = new Map<number, Draft>();
  let current: number | null = null;
  for (const raw of answer.split(/\r?\n/)) {
    const line = cleanLine(raw);
    const claim = CLAIM_LINE.exec(line);
    if (claim) {
      const index = Number(claim[1]);
      const fresh = index >= 1 && index <= count && !drafts.has(index);
      current = fresh ? index : null;
      if (fresh) {
        const said = (claim[2] ?? '').toLowerCase() as Verdict;
        drafts.set(index, { index, said, why: '', correction: null, sources: [] });
      }
      continue;
    }
    const field = FIELD_LINE.exec(line);
    const draft = current === null ? undefined : drafts.get(current);
    if (field && draft)
      drafts.set(draft.index, withField(draft, (field[1] ?? '').toUpperCase(), field[2] ?? ''));
  }
  return Array.from({ length: count }, (_, at) => {
    const draft = drafts.get(at + 1);
    return draft
      ? settled(draft)
      : {
          index: at + 1,
          verdict: 'unsure',
          why: 'The check gave no answer for it.',
          correction: null,
          sources: [],
        };
  });
}
