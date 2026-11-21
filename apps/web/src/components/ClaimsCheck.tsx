import { acceptClaim, applyCorrection } from '@jgtube/core/src/research/claimEdits';
import { MAX_CLAIMS_PER_RUN } from '@jgtube/core/src/research/claims';
import { useState } from 'react';
import {
  CLAIM_FILTERS,
  filterClaims,
  markerClaims,
  type ClaimFilter,
  type ClaimView,
  type MarkerClaim,
} from '../lib/research';
import { PILL, QUIET_BUTTON } from './LabStatus';
import { SourceLink } from './SourceLink';
import type { Research } from './useResearch';

const TONE: Readonly<Record<ClaimView['verdict'], string>> = {
  confirmed: 'text-primary-fixed-dim',
  wrong: 'text-error',
  unsure: 'text-metric-amber',
};

interface RowProps {
  readonly row: MarkerClaim;
  readonly onChange: (text: (now: string) => string) => void;
}

/** One marked claim, its verdict with its sources, and what the owner can do with it. */
function ClaimRow({ row, onChange }: RowProps) {
  const { claim, verdict } = row;
  return (
    <li className="flex min-w-0 flex-col gap-1 rounded bg-space-deep p-space-sm">
      <span className="flex flex-wrap items-center gap-2">
        <span className={`${PILL} uppercase ${verdict ? TONE[verdict.verdict] : 'text-outline'}`}>
          {verdict ? verdict.verdict : 'not checked'}
        </span>
        <span className="text-body-sm text-outline">{claim.what}</span>
      </span>
      <span className="break-words text-body-sm text-on-surface">{claim.sentence}</span>
      {verdict && (
        <>
          {verdict.why && (
            <span className="text-body-sm text-on-surface-variant">{verdict.why}</span>
          )}
          {verdict.correction && (
            <span className="text-body-sm text-on-surface">Correction: {verdict.correction}</span>
          )}
          <span className="flex flex-wrap gap-x-2 text-body-sm">
            {verdict.sources.map((source) => (
              <SourceLink key={source} href={source} />
            ))}
          </span>
          <span className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              onClick={() => onChange((now) => acceptClaim(now, claim))}
              className={QUIET_BUTTON}
            >
              Accept
            </button>
            {verdict.correction && (
              <button
                type="button"
                onClick={() =>
                  onChange((now) => applyCorrection(now, claim, verdict.correction ?? ''))
                }
                className={QUIET_BUTTON}
              >
                Apply the correction
              </button>
            )}
            <span className="self-center text-body-sm text-outline">or leave it marked</span>
          </span>
        </>
      )}
    </li>
  );
}

interface Props {
  readonly research: Research;
  readonly text: string;
  readonly busy: boolean;
  /** Changes the text in the editor; called only when the owner presses a button. */
  readonly onChange: (text: string) => void;
}

/**
 * The optional claims check: the facts the script still marks, checked on
 * the web ten at a time, each verdict beside its marker. Nothing in the
 * script changes until the owner presses Accept or Apply the correction.
 */
export function ClaimsCheck({ research, text, busy, onChange }: Props) {
  const [filter, setFilter] = useState<ClaimFilter>('all');
  const rows = markerClaims(text, research.view?.claims ?? []);
  if (rows.length === 0) return null;
  const shown = filterClaims(rows, filter);
  const unchecked = filterClaims(rows, 'unchecked').length;
  return (
    <details className="min-w-0 rounded bg-surface-card p-space-md shadow-md">
      <summary className="cursor-pointer text-title-md text-on-surface">
        Claims check (optional) · {rows.length} marked
      </summary>
      <div className="mt-space-sm flex min-w-0 flex-col gap-space-sm">
        <p className="text-body-sm text-on-surface-variant">
          Checks the claims still marked [CHECK] on the web, ten at a time. It uses more plan
          allowance, and its sources can be wrong: open them before you accept anything.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy || unchecked === 0}
            onClick={research.checkClaims}
            className={QUIET_BUTTON}
          >
            {unchecked === 0
              ? 'Every marked claim has been checked'
              : `Check the next ${Math.min(MAX_CLAIMS_PER_RUN, unchecked)} claims`}
          </button>
          {research.note && <span className="text-body-sm text-outline">{research.note}</span>}
        </div>
        <div role="radiogroup" aria-label="Show claims" className="flex flex-wrap gap-1.5">
          {CLAIM_FILTERS.map((option) => (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={filter === option.id}
              onClick={() => setFilter(option.id)}
              className={`rounded-full px-3 py-1 text-body-sm font-semibold ${
                filter === option.id
                  ? 'bg-primary-container text-space-deep'
                  : 'bg-surface-container-high text-on-surface-variant hover:text-on-surface'
              }`}
            >
              {option.label} ({filterClaims(rows, option.id).length})
            </button>
          ))}
        </div>
        <ul className="flex flex-col gap-2">
          {shown.map((row, index) => (
            <ClaimRow
              key={`${index}-${row.claim.what}`}
              row={row}
              onChange={(edit) => onChange(edit(text))}
            />
          ))}
        </ul>
      </div>
    </details>
  );
}
