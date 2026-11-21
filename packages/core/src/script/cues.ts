import { clock } from '../video/transcriptText';
import { CUE_LINE, HEADING_LINE, countWords } from './measure';

/**
 * Picture cues: the lines of a script that say what is on screen while the
 * words after them are spoken, written as
 * "[B-ROLL: what to show | search phrase | sound]". When each starts and ends
 * is worked out here, from the words spoken before it at a speaking rate. No
 * time is ever taken from the writer of the script.
 */

const SECOND_MS = 1000;
const SECONDS_PER_MINUTE = 60;

export interface Cue {
  /** What to show. */
  readonly show: string;
  /** A phrase to search footage with, or a prompt to make the picture from. */
  readonly search: string;
  /** A sound effect or music note; empty when the cue gives none. */
  readonly sound: string;
  /** When the words under the cue start and end, in whole seconds. */
  readonly startSeconds: number;
  readonly endSeconds: number;
  /** The words spoken under it. */
  readonly words: number;
}

interface OpenCue {
  readonly parts: readonly string[];
  readonly spoken: readonly string[];
}

/** The script as its cues, each with the spoken lines that follow it up to the next cue. */
function cueBlocks(script: string): readonly OpenCue[] {
  return script.split('\n').reduce<readonly OpenCue[]>((cues, raw) => {
    const line = raw.trim();
    const body = CUE_LINE.exec(line)?.[1];
    if (body !== undefined) {
      return [...cues, { parts: body.split('|').map((part) => part.trim()), spoken: [] }];
    }
    const last = cues.at(-1);
    if (!last || HEADING_LINE.test(line)) return cues;
    return [...cues.slice(0, -1), { ...last, spoken: [...last.spoken, line] }];
  }, []);
}

/**
 * The cues of a script with their times at `wordsPerMinute`. The first cue
 * starts where it stands: words spoken before any cue push it later. Without
 * a rate there are no times, so there are no cues.
 */
export function parseCues(script: string, wordsPerMinute: number): readonly Cue[] {
  if (!Number.isFinite(wordsPerMinute) || wordsPerMinute <= 0) return [];
  const blocks = cueBlocks(script);
  const total = countWords(script);
  const under = blocks.map((block) => countWords(block.spoken.join('\n')));
  const before = total - under.reduce((sum, words) => sum + words, 0);
  const at = (words: number): number => Math.round((words * SECONDS_PER_MINUTE) / wordsPerMinute);
  return blocks.map((block, index) => {
    const start = before + under.slice(0, index).reduce((sum, words) => sum + words, 0);
    const words = under[index] ?? 0;
    return {
      show: block.parts[0] ?? '',
      search: block.parts[1] ?? '',
      sound: block.parts.slice(2).join(' | '),
      startSeconds: at(start),
      endSeconds: at(start + words),
      words,
    };
  });
}

/** What a spreadsheet would run as a formula if a cell began with it. */
const FORMULA_START = /^[=+\-@]/;
const NEEDS_QUOTES = /[",\r\n]/;

function cell(value: string): string {
  const safe = FORMULA_START.test(value) ? `'${value}` : value;
  return NEEDS_QUOTES.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/**
 * Rows as CSV text: cells with a comma, a quote or a line break are quoted
 * and their quotes doubled, rows end with CR LF, and a cell that begins like
 * a formula gets an apostrophe in front so a spreadsheet shows it as text.
 */
export function toCsv(rows: readonly (readonly string[])[]): string {
  return rows.map((row) => `${row.map(cell).join(',')}\r\n`).join('');
}

const COLUMNS = [
  'Shot',
  'Starts',
  'Ends',
  'What to show',
  'Search phrase or picture prompt',
  'Sound or music',
] as const;

/** The shot list as a CSV file: a first row of column names, then one row per cue. */
export function shotListCsv(cues: readonly Cue[]): string {
  return toCsv([
    COLUMNS,
    ...cues.map((cue, index) => [
      String(index + 1),
      clock(cue.startSeconds * SECOND_MS),
      clock(cue.endSeconds * SECOND_MS),
      cue.show,
      cue.search,
      cue.sound,
    ]),
  ]);
}
