/**
 * A format the owner builds: one slot per layer, each filled with an
 * ingredient from the shelf (or left empty), with a note. Every change makes
 * a new value; nothing here changes the format it is given.
 */
import type { FormatBible } from './bible';
import { INGREDIENT_LAYERS, type IngredientLayer } from './types';

/** The most characters of a format's name, its notes and a slot's note. */
export const MAX_FORMAT_NAME = 60;
export const MAX_FORMAT_NOTES = 4_000;
export const MAX_SLOT_NOTE = 1_000;
/** A Short is under a minute; the longest video a format is planned for is three hours. */
export const MIN_FORMAT_SECONDS = 10;
export const MAX_FORMAT_SECONDS = 3 * 60 * 60;

export interface FormatSlot {
  readonly ingredientId: number;
  readonly note: string;
}

export type FormatSlots = Readonly<Partial<Record<IngredientLayer, FormatSlot>>>;

/** One slot of an AI's suggested mix, as code kept it. */
export interface SuggestedSlot {
  readonly layer: IngredientLayer;
  readonly ingredientId: number;
  /** The AI's one line on why, citing the evidence: its reading, never a measurement. */
  readonly reason: string;
}

export interface MixSuggestion {
  readonly slots: readonly SuggestedSlot[];
  /** The AI's one-paragraph reading of the mix as a whole. */
  readonly summary: string;
  /** What the answer proposed that was not kept, each with why. */
  readonly dropped: readonly string[];
  readonly engine: string;
  /** When it was written, as an ISO-8601 string. */
  readonly writtenAt: string;
}

export interface Format {
  readonly id: number;
  /** The channel it is a format of; null when it was made with no map open. */
  readonly channelId: string | null;
  readonly name: string;
  /** The length it is planned for; null when the owner has not said. */
  readonly targetSeconds: number | null;
  readonly notes: string;
  readonly slots: FormatSlots;
  readonly suggestion: MixSuggestion | null;
  /** The last Format Bible written for it; null when none is. */
  readonly bible: FormatBible | null;
  /** The format it was copied from, when it is a copy. */
  readonly copiedFrom: number | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** What the owner can change on a format. */
export interface FormatChange {
  readonly name?: string;
  readonly targetSeconds?: number | null;
  readonly notes?: string;
  readonly slots?: FormatSlots;
}

export const SLOT_LAYERS: readonly IngredientLayer[] = INGREDIENT_LAYERS;

/** The format with this ingredient in the layer's slot; the slot's note is kept. */
export function fillSlot(
  slots: FormatSlots,
  layer: IngredientLayer,
  ingredientId: number,
): FormatSlots {
  return { ...slots, [layer]: { ingredientId, note: slots[layer]?.note ?? '' } };
}

/** The format with the layer's slot empty. */
export function clearSlot(slots: FormatSlots, layer: IngredientLayer): FormatSlots {
  return Object.fromEntries(Object.entries(slots).filter(([key]) => key !== layer)) as FormatSlots;
}

/** The format with a note on a filled slot; an empty slot takes no note. */
export function noteSlot(slots: FormatSlots, layer: IngredientLayer, note: string): FormatSlots {
  const slot = slots[layer];
  if (!slot) return slots;
  return { ...slots, [layer]: { ...slot, note: note.slice(0, MAX_SLOT_NOTE) } };
}

/** The slots a suggestion fills, over the ones there are; the owner's notes stay. */
export function applySuggestion(slots: FormatSlots, suggestion: MixSuggestion): FormatSlots {
  return suggestion.slots.reduce(
    (current, slot) => fillSlot(current, slot.layer, slot.ingredientId),
    slots,
  );
}

/** The slots without any that name an ingredient no longer on the shelf. */
export function liveSlots(slots: FormatSlots, onShelf: ReadonlySet<number>): FormatSlots {
  return Object.fromEntries(
    Object.entries(slots).filter(
      ([, slot]) => slot !== undefined && onShelf.has(slot.ingredientId),
    ),
  ) as FormatSlots;
}

/** Why a change cannot be made, in plain words, or null when it can. */
export function changeProblem(change: FormatChange): string | null {
  if (change.name !== undefined) {
    const name = change.name.trim();
    if (name === '' || name.length > MAX_FORMAT_NAME) {
      return `A format needs a name of 1 to ${MAX_FORMAT_NAME} characters.`;
    }
  }
  const target = change.targetSeconds;
  if (
    target !== undefined &&
    target !== null &&
    (!Number.isInteger(target) || target < MIN_FORMAT_SECONDS || target > MAX_FORMAT_SECONDS)
  ) {
    return 'Give the length as 10 seconds to 3 hours.';
  }
  if (change.notes !== undefined && change.notes.length > MAX_FORMAT_NOTES) {
    return 'Those notes are too long to keep.';
  }
  return null;
}
