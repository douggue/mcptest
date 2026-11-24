/**
 * How the format builder's shelf is shown: the names of layers and sources,
 * filtering and ordering, the one-line evidence under each ingredient and
 * where its pictures are read from. Every number shown is one the server
 * worked out; nothing here makes one up.
 */
import { INGREDIENT_LAYERS, INGREDIENT_SOURCES } from '@jgtube/core/src/format/types';
import { compareByEvidence } from '@jgtube/core/src/format/evidence';
import type {
  Ingredient,
  IngredientEvidence,
  IngredientLayer,
  IngredientMedia,
  IngredientSource,
  MeasuredNumber,
} from '@jgtube/core';

export { INGREDIENT_LAYERS, INGREDIENT_SOURCES };

export const LAYER_LABELS: Readonly<Record<IngredientLayer, string>> = {
  title: 'Title formula',
  hook: 'Hook',
  structure: 'Structure',
  pacing: 'Pacing',
  visual: 'Visual style',
  motion: 'Motion and transitions',
  thumbnail: 'Thumbnail layout',
  sound: 'Sound',
  other: 'Other',
};

export const SOURCE_LABELS: Readonly<Record<IngredientSource, string>> = {
  formula: 'Formula',
  'transfer-format': 'Transfer format',
  'transfer-idea': 'Transfer',
  hook: 'Hook',
  video: 'Breakout',
  'own-video': 'Your video',
  thumbnail: 'Thumbnail',
  niche: 'New niche',
  'breakdown-part': 'Breakdown',
  teardown: 'Teardown',
  link: 'Link',
  clip: 'Clip',
  image: 'Picture',
  note: 'Note',
};

export type ShelfSort = 'proven' | 'newest';

export interface ShelfFilter {
  /** Null for every layer. */
  readonly layer: IngredientLayer | null;
  /** Null for every source. */
  readonly source: IngredientSource | null;
  readonly query: string;
  readonly sort: ShelfSort;
}

export const ALL: ShelfFilter = { layer: null, source: null, query: '', sort: 'proven' };

const searchable = (item: Ingredient): string =>
  [item.name, item.sourceLabel, item.note, LAYER_LABELS[item.layer]].join(' ').toLowerCase();

/** The ingredients that pass the filter, in its order. A new list; the given one is untouched. */
export function shelfItems(
  items: readonly Ingredient[],
  filter: ShelfFilter,
): readonly Ingredient[] {
  const words = filter.query.toLowerCase().split(/\s+/).filter(Boolean);
  const kept = items.filter(
    (item) =>
      (filter.layer === null || item.layer === filter.layer) &&
      (filter.source === null || item.source === filter.source) &&
      words.every((word) => searchable(item).includes(word)),
  );
  if (filter.sort === 'newest') {
    return [...kept].sort((a, b) => b.addedAt.localeCompare(a.addedAt) || b.id - a.id);
  }
  return [...kept].sort((a, b) => compareByEvidence(a, b) || b.id - a.id);
}

/** How many ingredients each layer holds, for the filter chips. */
export function layerCounts(
  items: readonly Ingredient[],
): Readonly<Record<IngredientLayer, number>> {
  const counts = Object.fromEntries(INGREDIENT_LAYERS.map((layer) => [layer, 0])) as Record<
    IngredientLayer,
    number
  >;
  return items.reduce((total, item) => ({ ...total, [item.layer]: total[item.layer] + 1 }), counts);
}

/** The sources there are on the shelf, in the fixed order, for the source chips. */
export const sourcesOn = (items: readonly Ingredient[]): readonly IngredientSource[] =>
  INGREDIENT_SOURCES.filter((source) => items.some((item) => item.source === source));

const plural = (count: number, word: string): string =>
  `${count.toLocaleString('en-US')} ${word}${count === 1 ? '' : 's'}`;

/** A score as the app writes it: "4.2×". */
export const scoreText = (score: number): string =>
  `${score >= 10 ? Math.round(score) : score.toFixed(1)}×`;

/**
 * What an ingredient rests on, in one line: "Proven · 4 videos · 3 channels
 * · 2.4× average of 4". Empty parts are left out; nothing counted says so.
 */
export function evidenceLine(evidence: IngredientEvidence, proven: boolean): string {
  const parts = [
    proven ? 'Proven' : null,
    evidence.videos === null ? null : plural(evidence.videos, 'video'),
    evidence.channels === null ? null : plural(evidence.channels, 'channel'),
    evidence.score === null
      ? null
      : evidence.scoredVideos > 1
        ? `${scoreText(evidence.score)} average of ${evidence.scoredVideos}`
        : `${scoreText(evidence.score)} its channel's usual`,
  ].filter((part): part is string => part !== null);
  return parts.length === 0 ? 'Nothing counted: your own' : parts.join(' · ');
}

/** One measured number as shown: "2.5 a minute", "70% of runtime", "-14 LUFS". */
export function measuredText(number: MeasuredNumber): string {
  const value =
    Math.abs(number.value) >= 1000
      ? Math.round(number.value).toLocaleString('en-US')
      : String(Math.round(number.value * 10) / 10);
  if (number.unit === '') return value;
  return number.unit.startsWith('%') ? `${value}${number.unit}` : `${value} ${number.unit}`;
}

/** Where a picture of an ingredient is read from; null for a quote. */
export function mediaUrl(media: IngredientMedia): string | null {
  switch (media.kind) {
    case 'thumbnail':
      return `https://i.ytimg.com/vi/${media.videoId}/mqdefault.jpg`;
    case 'keyframe':
    case 'strip':
      return `/api/video-teardowns/${media.videoId}/images/${media.file}`;
    case 'image':
      return `/api/format/images/${media.file}`;
    case 'quote':
      return null;
  }
}

/** The hex colours an ingredient's details carry as measured, for a swatch row. */
export function paletteOf(
  item: Ingredient,
): readonly { readonly hex: string; readonly share: number }[] {
  const palette = item.details['palette'];
  if (!Array.isArray(palette)) return [];
  return palette.flatMap((entry: unknown) => {
    if (typeof entry !== 'object' || entry === null) return [];
    const { hex, share } = entry as { hex?: unknown; share?: unknown };
    return typeof hex === 'string' && /^#[0-9A-F]{6}$/i.test(hex) && typeof share === 'number'
      ? [{ hex, share }]
      : [];
  });
}

/** The largest picture the shelf takes, the server's own cap. */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

/** Why a chosen picture cannot be sent, in one line; null when it can. */
export function imageProblem(file: {
  readonly type: string;
  readonly size: number;
}): string | null {
  if (!IMAGE_TYPES.includes(file.type)) return 'Choose a PNG, JPEG or WebP picture.';
  if (file.size === 0) return 'That picture is empty.';
  return file.size > MAX_IMAGE_BYTES ? 'A picture may be 8 MB at most.' : null;
}

/** Whether an ingredient's text is an engine's reading rather than something counted. */
export const isReading = (item: Ingredient): boolean =>
  'reading' in item.details && item.details['reading'] !== null;
