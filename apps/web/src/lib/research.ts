import { claimsToCheck, type Claim } from '@jgtube/core/src/research/claims';
import { factRefs } from '@jgtube/core/src/research/factSheet';

/**
 * The script writer's research as the page reads it: a concept's fact sheet,
 * the facts a script names with their sources, and the claims check beside
 * each marker still in the script. The shapes are the server's.
 */

export interface FactView {
  readonly number: number;
  readonly text: string;
  readonly sources: readonly string[];
}

export interface FactSheetView {
  readonly conceptId: number;
  readonly facts: readonly FactView[];
  readonly notFound: readonly string[];
  readonly disputed: readonly string[];
  readonly engine: string;
  readonly writtenAt: string;
}

export interface ClaimView extends Claim {
  readonly verdict: 'confirmed' | 'wrong' | 'unsure';
  readonly why: string;
  readonly correction: string | null;
  readonly sources: readonly string[];
  readonly engine: string;
  readonly checkedAt: string;
}

export interface ResearchView {
  readonly sheet: FactSheetView | null;
  readonly claims: readonly ClaimView[];
}

export interface ResearchOutcome {
  readonly kind: 'research';
  readonly conceptId: number;
  readonly sheet: FactSheetView;
}

export interface ClaimsOutcome {
  readonly kind: 'claims';
  readonly conceptId: number;
  readonly checked: number;
  readonly remaining: number;
  readonly claims: readonly ClaimView[];
}

/** The facts of the sheet the script names, in the order first named. */
export function usedFacts(script: string, sheet: FactSheetView | null): readonly FactView[] {
  if (sheet === null) return [];
  return factRefs(script).flatMap((number) => sheet.facts.filter((fact) => fact.number === number));
}

/** The numbered source list a Markdown file ends with; none when the script names no fact. */
export function sourcesMarkdown(script: string, sheet: FactSheetView | null): readonly string[] {
  const facts = usedFacts(script, sheet);
  if (facts.length === 0) return [];
  return [
    '## Sources',
    '',
    ...facts.map(
      (fact, at) => `${at + 1}. [F${fact.number}] ${fact.text} ${fact.sources.join(' · ')}`,
    ),
    '',
  ];
}

/** A marker still in the script, with the verdict of the claims check when it was checked. */
export interface MarkerClaim {
  readonly claim: Claim;
  readonly verdict: ClaimView | null;
}

/** The markers still in the script, in order, each with its stored verdict. */
export function markerClaims(script: string, claims: readonly ClaimView[]): readonly MarkerClaim[] {
  return claimsToCheck(script).map((claim) => ({
    claim,
    verdict:
      claims.find((one) => one.what === claim.what && one.sentence === claim.sentence) ?? null,
  }));
}

export type ClaimFilter = 'all' | 'wrong' | 'unsure' | 'confirmed' | 'unchecked';

export const CLAIM_FILTERS: readonly { readonly id: ClaimFilter; readonly label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'wrong', label: 'Wrong' },
  { id: 'unsure', label: 'Unsure' },
  { id: 'confirmed', label: 'Confirmed' },
  { id: 'unchecked', label: 'Not checked' },
];

export function filterClaims(
  rows: readonly MarkerClaim[],
  filter: ClaimFilter,
): readonly MarkerClaim[] {
  if (filter === 'all') return rows;
  if (filter === 'unchecked') return rows.filter((row) => row.verdict === null);
  return rows.filter((row) => row.verdict?.verdict === filter);
}
