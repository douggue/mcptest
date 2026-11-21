import { HEADING_LINE, CUE_LINE, checkMarkers } from '../script/measure';
import type { Claim } from './claims';

/**
 * What the owner's press does to a script after a claims check, and only
 * then: accept a claim (its marker goes), or apply a correction (the
 * sentence is replaced by the corrected one, with a visible [FIXED: ...] note
 * that is never spoken). A claim no longer in the script changes nothing.
 */

const CHECK_MARKER = /\[CHECK:\s*([^\]]*)\]/g;

interface Spot {
  readonly line: number;
  readonly start: number;
  readonly end: number;
}

const isSpoken = (line: string): boolean =>
  !HEADING_LINE.test(line.trim()) && !CUE_LINE.test(line.trim());

/** Where each marker of the spoken lines stands, in the order `checkMarkers` lists them. */
function spots(lines: readonly string[]): readonly Spot[] {
  return lines.flatMap((text, line) =>
    isSpoken(text)
      ? [...text.matchAll(CHECK_MARKER)].map((match) => ({
          line,
          start: match.index,
          end: match.index + match[0].length,
        }))
      : [],
  );
}

/** The marker of this claim, found by its words and its sentence; null when it is gone. */
function spotOf(script: string, claim: Claim): Spot | null {
  const lines = script.split('\n');
  const at = checkMarkers(script).findIndex(
    (marker) => marker.what === claim.what && marker.near === claim.sentence,
  );
  return at < 0 ? null : (spots(lines)[at] ?? null);
}

/** The script with one line changed. */
function withLine(script: string, line: number, text: string): string {
  return script
    .split('\n')
    .map((old, index) => (index === line ? text : old))
    .join('\n');
}

/** The script without this claim's marker. */
export function acceptClaim(script: string, claim: Claim): string {
  const spot = spotOf(script, claim);
  if (spot === null) return script;
  const text = script.split('\n')[spot.line] ?? '';
  const before = text.slice(0, spot.start).replace(/[ \t]+$/, '');
  return withLine(script, spot.line, `${before}${text.slice(spot.end)}`);
}

/** Where the sentence around a marker starts and ends in its line. */
function sentenceBounds(text: string, spot: Spot): { readonly from: number; readonly to: number } {
  const before = text.slice(0, spot.start);
  const start = Math.max(
    before.lastIndexOf('. '),
    before.lastIndexOf('! '),
    before.lastIndexOf('? '),
  );
  const rest = text.slice(spot.end);
  const end = rest.search(/[.!?](\s|$)/);
  return { from: start < 0 ? 0 : start + 2, to: end < 0 ? text.length : spot.end + end + 1 };
}

/** The script with this claim's sentence replaced by the correction, and a note that says so. */
export function applyCorrection(script: string, claim: Claim, correction: string): string {
  const spot = spotOf(script, claim);
  if (spot === null) return script;
  const text = script.split('\n')[spot.line] ?? '';
  const { from, to } = sentenceBounds(text, spot);
  const said = correction.trim().replace(/\s+/g, ' ');
  const ended = /[.!?]$/.test(said) ? said : `${said}.`;
  const note = `[FIXED: ${claim.what.replace(/[[\]]/g, '')}]`;
  return withLine(script, spot.line, `${text.slice(0, from)}${ended} ${note}${text.slice(to)}`);
}
