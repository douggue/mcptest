import { CUE_LINE, HEADING_LINE } from '@jgtube/core/src/script/measure';

/**
 * A script's text as the owner reads it: headings, picture cues as chips and
 * spoken lines with the facts to check marked, instead of the raw markers.
 */

export type LinePart =
  | { readonly kind: 'text'; readonly text: string }
  /** A fact the writer could not vouch for, with what to check. */
  | { readonly kind: 'check'; readonly what: string };

export type ScriptBlock =
  | { readonly kind: 'heading'; readonly text: string }
  | {
      readonly kind: 'cue';
      readonly show: string;
      readonly search: string | null;
      readonly sound: string | null;
    }
  | { readonly kind: 'line'; readonly parts: readonly LinePart[] };

const CHECK = /\[CHECK:\s*([^\]]*)\]/g;

const orNull = (text: string | undefined): string | null => {
  const trimmed = text?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
};

/** A spoken line split into its words and its markers. */
function lineParts(line: string): readonly LinePart[] {
  const parts: LinePart[] = [];
  let at = 0;
  for (const match of line.matchAll(CHECK)) {
    const before = line.slice(at, match.index);
    if (before.trim() !== '') parts.push({ kind: 'text', text: before.trimEnd() });
    parts.push({ kind: 'check', what: (match[1] ?? '').trim() });
    at = (match.index ?? 0) + match[0].length;
  }
  const rest = line.slice(at);
  if (rest.trim() !== '') parts.push({ kind: 'text', text: rest.trim() });
  return parts;
}

/** One line of the script as a block; null for an empty line. */
function blockOf(line: string): ScriptBlock | null {
  const trimmed = line.trim();
  if (trimmed === '') return null;
  if (HEADING_LINE.test(trimmed)) {
    return { kind: 'heading', text: trimmed.replace(HEADING_LINE, '') };
  }
  const cue = CUE_LINE.exec(trimmed)?.[1];
  if (cue !== undefined) {
    const [show, search, sound] = cue.split('|');
    return { kind: 'cue', show: orNull(show) ?? '', search: orNull(search), sound: orNull(sound) };
  }
  return { kind: 'line', parts: lineParts(trimmed) };
}

/** The script's text as blocks to read, in order, without empty lines. */
export function readableBlocks(text: string): readonly ScriptBlock[] {
  return text.split('\n').flatMap((line) => {
    const block = blockOf(line);
    return block ? [block] : [];
  });
}
