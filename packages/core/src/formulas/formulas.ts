import { readBlocks, single, type LabelledBlock } from '../labelled';

/**
 * Title formulas: a wording several breakout titles on one channel's map
 * share, with named slots for what changes ("Why [Thing] Quietly
 * Disappeared"). Seeing that two titles are the same frame is a judgement of
 * meaning, so an engine proposes the formulas. Everything shown about one is
 * decided here: which of the videos it names really are stored videos of this
 * map inside the window, whether enough are left, and every number.
 *
 * Nothing here knows any channel, subject or word: the rules are counts.
 */

/** The windows the owner can choose between, in days. */
export const FORMULA_WINDOWS = [30, 90] as const;
export type FormulaWindow = (typeof FORMULA_WINDOWS)[number];
/** Ninety days: what the transfer list also counts as "now", and enough titles to see a pattern in. */
export const FORMULA_DEFAULT_WINDOW_DAYS: FormulaWindow = 90;
/** One video is an example, not a format: a formula needs this many verified videos behind it. */
export const FORMULA_MIN_VIDEOS = 2;
/**
 * The fixed words a formula needs besides its slots. One word, such as an
 * article, around a row of slots is a shape any title fits.
 */
export const FORMULA_MIN_FIXED_WORDS = 2;
/** The most formulas kept from one run: more than a page of cards helps nobody choose. */
export const FORMULA_MAX_KEPT = 12;
/** A formula is a title with slots, so it is no longer than a title may be, with room for slot names. */
const MAX_FORMULA_CHARS = 160;
/** One sentence. */
const MAX_WHY_CHARS = 300;
const MAX_SLOT_CHARS = 40;

const LABELS = ['FORMULA', 'WHY', 'VIDEOS'] as const;
const OPENS = /^FORMULA\s*:/;
const VIDEO_ID = /(?<![\w-])[\w-]{11}(?![\w-])/g;
const SLOT = /\[([^[\]]*)\]/g;

/** A formula as an engine gave it, before anything was checked. */
export interface ParsedFormula {
  readonly formula: string;
  readonly why: string;
  readonly videoIds: readonly string[];
}

export interface ParsedFormulas {
  readonly formulas: readonly ParsedFormula[];
  /** Entries the answer set out that had a part missing, doubled or too long. */
  readonly unread: number;
}

function formulaOf(block: LabelledBlock): ParsedFormula | null {
  const formula = single(block, 'FORMULA');
  const why = single(block, 'WHY');
  const videos = single(block, 'VIDEOS');
  if (!formula || !why || !videos) return null;
  if (formula.length > MAX_FORMULA_CHARS || why.length > MAX_WHY_CHARS) return null;
  return { formula, why, videoIds: [...new Set(videos.match(VIDEO_ID) ?? [])] };
}

/** The formulas in an answer, each with the video ids it names. Nothing is checked yet. */
export function parseFormulas(answer: string): ParsedFormulas {
  const read = readBlocks(answer, { labels: LABELS, opens: (line) => OPENS.test(line) }).map(
    formulaOf,
  );
  const formulas = read.filter((formula): formula is ParsedFormula => formula !== null);
  return { formulas, unread: read.length - formulas.length };
}

export type FormulaPart = { readonly text: string } | { readonly slot: string };

/** A formula as its fixed words and its named slots, in order, for the screen to set apart. */
export function formulaParts(formula: string): readonly FormulaPart[] {
  const parts = formula.split(/(\[[^[\]]*\])/).map((piece): FormulaPart | null => {
    const slot = /^\[([^[\]]*)\]$/.exec(piece)?.[1];
    if (slot !== undefined) return { slot: slot.trim() };
    return piece.trim() === '' ? null : { text: piece.trim() };
  });
  return parts.filter((part): part is FormulaPart => part !== null);
}

/** A stored video of a channel on the map, inside the window, with its numbers from the store. */
export interface FormulaVideo {
  readonly videoId: string;
  readonly title: string;
  readonly channelId: string;
  readonly channelTitle: string;
  readonly views: number;
  /** Multiple of its channel's usual views; null when it cannot be judged. */
  readonly score: number | null;
  readonly ageDays: number;
}

/** A formula that passed every check, with numbers worked out from the store. */
export interface VerifiedFormula {
  readonly formula: string;
  readonly why: string;
  /** Strongest first; a video without a score comes after the scored ones, by views. */
  readonly videos: readonly FormulaVideo[];
  readonly videoCount: number;
  /** How many channels those videos come from: one channel repeating itself is weaker evidence. */
  readonly channelCount: number;
  /** The mean score of the videos that have one; null when none has. */
  readonly averageScore: number | null;
  /** How many of the videos the average was taken over. */
  readonly scoredCount: number;
}

export interface DroppedFormula {
  readonly formula: string;
  /** Why it is not shown, in plain words. */
  readonly reason: string;
}

export interface VerifiedFormulas {
  readonly kept: readonly VerifiedFormula[];
  readonly dropped: readonly DroppedFormula[];
}

/** Why a formula's wording is no format, or null when it is one. */
function wordingProblem(formula: string): string | null {
  const slots = [...formula.matchAll(SLOT)].map((match) => (match[1] ?? '').trim());
  const outside = formula.replace(SLOT, ' ');
  if (/[[\]]/.test(outside)) return 'A slot in it is not closed, so it cannot be read.';
  if (slots.length === 0) return 'It has no slot: that is one title, not a format.';
  if (slots.some((slot) => slot === '' || slot.length > MAX_SLOT_CHARS)) {
    return 'One of its slots has no name, or a sentence for a name.';
  }
  const fixedWords = outside.split(/\s+/).filter((word) => /\p{L}|\p{N}/u.test(word));
  return fixedWords.length < FORMULA_MIN_FIXED_WORDS
    ? `It has fewer than ${FORMULA_MIN_FIXED_WORDS} fixed words around its slots, so any title would fit it.`
    : null;
}

const byStrength = (a: FormulaVideo, b: FormulaVideo): number =>
  (b.score ?? -1) - (a.score ?? -1) || b.views - a.views;

function verified(parsed: ParsedFormula, videos: readonly FormulaVideo[]): VerifiedFormula {
  const scores = videos.flatMap((video) => (video.score === null ? [] : [video.score]));
  const total = scores.reduce((sum, score) => sum + score, 0);
  return {
    formula: parsed.formula,
    why: parsed.why,
    videos: [...videos].sort(byStrength),
    videoCount: videos.length,
    channelCount: new Set(videos.map((video) => video.channelId)).size,
    averageScore: scores.length === 0 ? null : total / scores.length,
    scoredCount: scores.length,
  };
}

/**
 * What is shown of the formulas an engine gave. `stored` holds the videos a
 * formula may rest on: the stored videos of the channels on this map inside
 * the window. An id that is not among them is dropped; a formula left with
 * fewer than `FORMULA_MIN_VIDEOS`, or whose wording is no format, is dropped
 * with the reason; a formula given twice is kept once.
 */
export function verifyFormulas(
  parsed: readonly ParsedFormula[],
  stored: ReadonlyMap<string, FormulaVideo>,
): VerifiedFormulas {
  const seen = new Set<string>();
  const judged = parsed.flatMap((one): (VerifiedFormula | DroppedFormula)[] => {
    const key = one.formula.toLowerCase().replace(/\s+/g, ' ');
    if (seen.has(key)) return [];
    seen.add(key);
    const problem = wordingProblem(one.formula);
    if (problem) return [{ formula: one.formula, reason: problem }];
    const videos = one.videoIds.flatMap((id) => stored.get(id) ?? []);
    return videos.length < FORMULA_MIN_VIDEOS
      ? [
          {
            formula: one.formula,
            reason: `Fewer than ${FORMULA_MIN_VIDEOS} of the videos it names are stored videos of this map inside the window.`,
          },
        ]
      : [verified(one, videos)];
  });
  const kept = judged.filter((one): one is VerifiedFormula => 'videos' in one);
  return {
    kept: kept.slice(0, FORMULA_MAX_KEPT),
    dropped: judged.filter((one): one is DroppedFormula => 'reason' in one),
  };
}
