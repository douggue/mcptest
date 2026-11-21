import type { ConceptLength, PickedVideo, StoredConcept } from '@jgtube/core';
import {
  MAX_TITLE_CHARS,
  PHONE_TITLE_CHARS,
  SHORTS_TITLE_CHARS,
} from '@jgtube/core/src/concepts/parse';
import { AUTOMATIC, type EngineChoice, type EngineId, type SkippedEngine } from './analyses';
import type { LibraryHook } from './hookLibrary';

/**
 * The idea lab as the page reads it: the videos picked as inspiration, what a
 * batch is asked for, and the concepts that came back. The shapes of what
 * the server answers are the server's.
 */

/** The most videos a batch rests on; the server refuses more. */
export const MAX_PICKS = 5;
export { PHONE_TITLE_CHARS, SHORTS_TITLE_CHARS };
/** YouTube takes no title longer than this. */
export const YOUTUBE_TITLE_CHARS = MAX_TITLE_CHARS;
/** The overlay is asked for in this many words or fewer. */
const OVERLAY_WORDS = 4;
const NEIGHBOURS = 2;

/** A video picked as inspiration. */
export interface Pick {
  readonly videoId: string;
  readonly title: string;
  readonly channelTitle: string;
  /** It came from the hook library: the owner wants its way of opening modelled. */
  readonly modelOpening: boolean;
}

/**
 * The picks with one video added, or taken away when it was there. A video
 * already picked that is now picked for its opening stays and is marked. Past
 * `MAX_PICKS` the list is handed back as it was.
 */
export function togglePick(picks: readonly Pick[], pick: Pick): readonly Pick[] {
  const existing = picks.find((entry) => entry.videoId === pick.videoId);
  if (existing && pick.modelOpening && !existing.modelOpening) {
    return picks.map((entry) => (entry === existing ? { ...entry, modelOpening: true } : entry));
  }
  if (existing) return picks.filter((entry) => entry !== existing);
  return picks.length >= MAX_PICKS ? picks : [...picks, pick];
}

export const canGenerate = (picks: readonly Pick[], busy: boolean): boolean =>
  picks.length > 0 && !busy;

/** What the owner set in the lab besides the picks. */
export interface LabChoices {
  /** A value from `formatOptions`, or '' for no format. */
  readonly format: string;
  readonly angle: string;
  readonly length: ConceptLength;
}

export type FormatChoice =
  | { readonly source: 'transfer'; readonly key: string }
  | { readonly source: 'formula'; readonly id: number };

export interface FormatOption {
  readonly value: string;
  readonly label: string;
  /** The heading it is listed under. */
  readonly group: string;
}

const FORMULA = 'formula:';
const TRANSFER = 'transfer:';
const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`;

/**
 * The formats on offer: the formulas found for this channel, then the title
 * formats of its transfer list. The value says which kind it is, so only a
 * key or an id is ever sent, never a wording.
 */
export function formatOptions(
  templates: readonly {
    readonly key: string;
    readonly template: string;
    readonly subjectCount: number;
  }[],
  formulas: readonly {
    readonly id: number;
    readonly formula: string;
    readonly videoCount: number;
  }[],
): readonly FormatOption[] {
  return [
    ...formulas.map((one) => ({
      value: `${FORMULA}${one.id}`,
      label: `${one.formula} (${plural(one.videoCount, 'video')})`,
      group: 'Trending formats',
    })),
    ...templates.map((one) => ({
      value: `${TRANSFER}${one.key}`,
      label: `${one.template} (${plural(one.subjectCount, 'subject')})`,
      group: 'Title formats',
    })),
  ];
}

/** A chosen option as the server takes it; null for none or for anything unknown. */
export function formatChoiceOf(value: string): FormatChoice | null {
  if (value.startsWith(TRANSFER) && value.length > TRANSFER.length) {
    return { source: 'transfer', key: value.slice(TRANSFER.length) };
  }
  const id = value.startsWith(FORMULA) ? Number(value.slice(FORMULA.length)) : Number.NaN;
  return Number.isSafeInteger(id) && id > 0 ? { source: 'formula', id } : null;
}

/** The body of the request that starts a batch: ids, a key or an id, and the owner's one line. */
export function batchRequest(
  channel: string,
  picks: readonly Pick[],
  choices: LabChoices,
  engine: EngineChoice,
): Record<string, unknown> {
  const format = formatChoiceOf(choices.format);
  const angle = choices.angle.trim();
  return {
    channel,
    inspiration: picks.map((pick) => pick.videoId),
    hookModels: picks.filter((pick) => pick.modelOpening).map((pick) => pick.videoId),
    length: choices.length,
    ...(format ? { format } : {}),
    ...(angle === '' ? {} : { angle }),
    ...(engine === AUTOMATIC ? {} : { engine }),
  };
}

/** Characters as a reader counts them: an accented letter or an emoji is one. */
function characters(text: string): number {
  return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].length;
}

export interface TitleCheck {
  readonly count: number;
  /** The length a phone's feed shows, for this kind of video. */
  readonly limit: number;
  readonly warning: string | null;
}

/** A title's length against what a phone shows and what YouTube takes. */
export function titleCheck(title: string, length: ConceptLength): TitleCheck {
  const count = characters(title);
  const limit = length === 'shorts' ? SHORTS_TITLE_CHARS : PHONE_TITLE_CHARS;
  if (count > YOUTUBE_TITLE_CHARS) {
    const warning = `Too long for YouTube: ${count} characters, and a title can be at most ${YOUTUBE_TITLE_CHARS}.`;
    return { count, limit, warning };
  }
  const warning =
    count > limit
      ? `May be cut off on a phone: ${count} characters, and a phone’s feed shows about ${limit}.`
      : null;
  return { count, limit, warning };
}

/** A note when the overlay has more words than were asked for, else null. */
export function overlayNote(overlay: string): string | null {
  const words = overlay.trim().split(/\s+/).filter(Boolean).length;
  return words > OVERLAY_WORDS ? `${words} words: more than the four asked for.` : null;
}

/**
 * The two real videos shown beside a draft: the breakouts of this map the
 * concept rests on first, then the strongest of the rest.
 */
export function previewNeighbours<T extends { readonly videoId: string; readonly score: number }>(
  breakouts: readonly T[],
  restsOn: readonly string[],
): readonly T[] {
  const strongest = [...breakouts].sort((a, b) => b.score - a.score);
  const own = strongest.filter((breakout) => restsOn.includes(breakout.videoId));
  const others = strongest.filter((breakout) => !restsOn.includes(breakout.videoId));
  return [...own, ...others].slice(0, NEIGHBOURS);
}

/** A concept as the server lists it. */
export interface ConceptView extends Omit<StoredConcept, 'createdAt'> {
  readonly createdAt: string;
  readonly length: ConceptLength;
  readonly angle: string | null;
  readonly formatTemplate: string | null;
  readonly restsOnVideos: readonly PickedVideo[];
  readonly pickedCount: number;
}

/** The concepts with one marked kept or not, the kept ones first and the order otherwise as it was. */
export function withKept(
  concepts: readonly ConceptView[],
  conceptId: number,
  kept: boolean,
): readonly ConceptView[] {
  const marked = concepts.map((one) => (one.id === conceptId ? { ...one, kept } : one));
  return [...marked.filter((one) => one.kept), ...marked.filter((one) => !one.kept)];
}

/** The hook of the library a concept's opening follows the way of, when its line names one. */
export function hookModelOf(
  hookStyle: string | null,
  hooks: readonly LibraryHook[],
): LibraryHook | null {
  if (hookStyle === null) return null;
  return hooks.find((hook) => hookStyle.includes(hook.videoId)) ?? null;
}

/** Who answered, and who was passed over on the way. */
export interface Answered {
  readonly engine: EngineId;
  readonly skipped: readonly SkippedEngine[];
}

export interface ConceptOutcome extends Answered {
  readonly kind: 'concepts';
  readonly batchId: number;
  readonly added: readonly ConceptView[];
  readonly asked: number;
  readonly unread: number;
  readonly note: string | null;
}

export interface AnswerOutcome extends Answered {
  readonly kind: 'answer';
  readonly text: string;
}
