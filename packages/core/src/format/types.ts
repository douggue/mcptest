/**
 * The format builder's shelf: ingredients, each one piece of a format taken
 * from one source (a title formula, a hook, a teardown's palette, a note of
 * the owner's). What an ingredient says it rests on (its evidence) is worked
 * out in code from the store when it is added; an engine never writes it.
 */

/** The layers a format is made of; every ingredient fills one. */
export const INGREDIENT_LAYERS = [
  'title',
  'hook',
  'structure',
  'pacing',
  'visual',
  'motion',
  'thumbnail',
  'sound',
  'other',
] as const;
export type IngredientLayer = (typeof INGREDIENT_LAYERS)[number];

/** Where an ingredient was taken from. */
export const INGREDIENT_SOURCES = [
  'formula',
  'transfer-format',
  'transfer-idea',
  'hook',
  'video',
  'own-video',
  'thumbnail',
  'niche',
  'breakdown-part',
  'teardown',
  'link',
  'clip',
  'image',
  'note',
] as const;
export type IngredientSource = (typeof INGREDIENT_SOURCES)[number];

/** One number code measured, with how. */
export interface MeasuredNumber {
  readonly label: string;
  readonly value: number;
  readonly unit: string;
  /** How it was worked out, in a few words. */
  readonly method: string;
}

/** What an ingredient rests on, every part from code. */
export interface IngredientEvidence {
  /** The outlier score (times the channel's usual), or the mean of several; null when none. */
  readonly score: number | null;
  /** How many scored videos the score is taken over; 0 without a score. */
  readonly scoredVideos: number;
  /** How many videos use it; null when that is not something that can be counted. */
  readonly videos: number | null;
  /** How many channels those videos come from; null when not counted. */
  readonly channels: number | null;
  readonly measured: readonly MeasuredNumber[];
}

/** A picture or a quote that shows what an ingredient is. */
export type IngredientMedia =
  | { readonly kind: 'thumbnail'; readonly videoId: string }
  | {
      readonly kind: 'keyframe' | 'strip';
      readonly videoId: string;
      readonly file: string;
    }
  | { readonly kind: 'quote'; readonly text: string; readonly videoId: string | null }
  | { readonly kind: 'image'; readonly file: string };

/** An ingredient as it is made from its source, before it is stored. */
export interface IngredientDraft {
  readonly layer: IngredientLayer;
  /** A short name, at most `MAX_INGREDIENT_NAME` characters. */
  readonly name: string;
  readonly source: IngredientSource;
  /** What identifies the source, so the same piece is not put on the shelf twice. */
  readonly sourceKey: string;
  /** The source as the owner would name it: a channel, a video title, "Your note". */
  readonly sourceLabel: string;
  /** The map it was found on, when it was found on one. */
  readonly centerChannelId: string | null;
  /** The channels it comes from: what the originality check counts. */
  readonly channelIds: readonly string[];
  /** What the source holds about it, as plain JSON values. */
  readonly details: Readonly<Record<string, unknown>>;
  readonly evidence: IngredientEvidence;
  readonly media: readonly IngredientMedia[];
}

/** An ingredient on the shelf. */
export interface Ingredient extends IngredientDraft {
  readonly id: number;
  /** The owner's own words about it; empty when none. */
  readonly note: string;
  /** When it was put on the shelf, as an ISO-8601 string. */
  readonly addedAt: string;
  /** Used by at least two videos of at least two channels: never one lucky video. */
  readonly proven: boolean;
}

export interface IngredientRepo {
  /** Every ingredient, the newest first. */
  list(): readonly Ingredient[];
  find(id: number): Ingredient | null;
  /**
   * Puts a draft on the shelf, or answers the one already there from the
   * same source for the same layer. Throws for a draft that breaks a rule.
   */
  add(draft: IngredientDraft, addedAt: Date): Ingredient;
  /** False when there is no such ingredient. */
  setNote(id: number, note: string): boolean;
  /** False when there is no such ingredient. */
  remove(id: number): boolean;
}
