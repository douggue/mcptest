/**
 * What a Format Bible may say as a number: the facts of a format, taken in
 * code from the ingredients in its slots (their evidence, the palette a
 * teardown measured, the hook's length worked out from its counted words).
 * An AI writes the Bible's words; every number in its tables comes from here.
 */
import { filledSlots, hookSeconds } from './checks';
import type { Format } from './formats';
import { mixPictures, type MixPicture } from './mixShelf';
import {
  INGREDIENT_LAYERS,
  type Ingredient,
  type IngredientEvidence,
  type IngredientLayer,
} from './types';

export interface BibleSlotFact {
  readonly layer: IngredientLayer;
  readonly ingredientId: number;
  readonly name: string;
  readonly from: string;
  readonly proven: boolean;
  readonly evidence: IngredientEvidence;
  readonly note: string;
  /** The hook's length in seconds, worked out in code; null for any other slot or none. */
  readonly hookSeconds: number | null;
}

export interface BibleMeasured {
  readonly layer: IngredientLayer;
  readonly from: string;
  readonly label: string;
  readonly value: number;
  readonly unit: string;
  readonly method: string;
}

export interface BibleColour {
  readonly hex: string;
  /** Share of the runtime, 0 to 1, as the teardown measured it. */
  readonly share: number;
  readonly from: string;
}

export interface BibleFormula {
  readonly formula: string;
  readonly videos: number | null;
  readonly channels: number | null;
  readonly score: number | null;
}

/** A role of type a teardown's AI reading named; text, never a measurement. */
export interface BibleTypeSeen {
  readonly role: string;
  readonly style: string;
  readonly casing: string | null;
}

export interface BibleFacts {
  readonly format: {
    readonly name: string;
    readonly targetSeconds: number | null;
    readonly notes: string;
  };
  readonly slots: readonly BibleSlotFact[];
  readonly measured: readonly BibleMeasured[];
  readonly palette: readonly BibleColour[];
  readonly titleFormulas: readonly BibleFormula[];
  /** Words a minute measured in a slot (pacing first); null when none was. */
  readonly wordsPerMinute: number | null;
  readonly typography: readonly BibleTypeSeen[];
  /** The slots' pictures on this computer, named as the shelf names them. */
  readonly pictures: readonly MixPicture[];
}

const HEX = /^#[0-9a-f]{6}$/i;
const WPM_LABEL = 'Words a minute';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

function paletteOf(item: Ingredient): readonly BibleColour[] {
  const palette = item.details['palette'];
  if (!Array.isArray(palette)) return [];
  return palette.flatMap((entry: unknown) => {
    if (!isRecord(entry)) return [];
    const { hex, share } = entry;
    if (typeof hex !== 'string' || !HEX.test(hex) || typeof share !== 'number') return [];
    return [{ hex: hex.toUpperCase(), share, from: item.sourceLabel }];
  });
}

function typographyOf(item: Ingredient): readonly BibleTypeSeen[] {
  const reading = item.details['reading'];
  if (item.details['section'] !== 'typography' || !Array.isArray(reading)) return [];
  return reading.flatMap((entry: unknown) => {
    if (!isRecord(entry) || typeof entry['role'] !== 'string') return [];
    const style = typeof entry['style'] === 'string' ? entry['style'] : '';
    const casing = typeof entry['casing'] === 'string' ? entry['casing'] : null;
    return [{ role: entry['role'], style, casing }];
  });
}

function formulaOf(item: Ingredient): BibleFormula {
  const formula = item.details['formula'];
  return {
    formula: typeof formula === 'string' ? formula : item.name,
    videos: item.evidence.videos,
    channels: item.evidence.channels,
    score: item.evidence.score,
  };
}

export function bibleFacts(format: Format, shelf: readonly Ingredient[]): BibleFacts {
  const filled = filledSlots(format.slots, shelf);
  const entries = INGREDIENT_LAYERS.flatMap((layer) => {
    const item = filled[layer];
    return item ? [[layer, item] as const] : [];
  });
  const measured = entries.flatMap(([layer, item]) =>
    item.evidence.measured.map((number) => ({
      layer,
      from: item.sourceLabel,
      label: number.label,
      value: number.value,
      unit: number.unit,
      method: number.method,
    })),
  );
  const paced = [...measured].sort(
    (a, b) => Number(b.layer === 'pacing') - Number(a.layer === 'pacing'),
  );
  return {
    format: { name: format.name, targetSeconds: format.targetSeconds, notes: format.notes },
    slots: entries.map(([layer, item]) => ({
      layer,
      ingredientId: item.id,
      name: item.name,
      from: item.sourceLabel,
      proven: item.proven,
      evidence: item.evidence,
      note: format.slots[layer]?.note ?? '',
      hookSeconds: layer === 'hook' ? hookSeconds(item) : null,
    })),
    measured,
    palette: entries.flatMap(([, item]) => paletteOf(item)),
    titleFormulas: entries.flatMap(([layer, item]) => (layer === 'title' ? [formulaOf(item)] : [])),
    wordsPerMinute: paced.find((number) => number.label === WPM_LABEL)?.value ?? null,
    typography: entries.flatMap(([, item]) => typographyOf(item)),
    pictures: mixPictures(entries.map(([, item]) => item)).local,
  };
}

const PERCENT = 100;
const MINUTE = 60;

/** Every number the facts hold, shares also as percentages and the length also in minutes. */
export function knownNumbers(facts: BibleFacts): ReadonlySet<number> {
  const target = facts.format.targetSeconds;
  const values = [
    ...(target === null ? [] : [target, Math.round((target / MINUTE) * 10) / 10]),
    ...facts.measured.map((number) => number.value),
    ...facts.palette.flatMap((colour) => [
      colour.share,
      Math.round(colour.share * PERCENT),
      Math.round(colour.share * PERCENT * 10) / 10,
    ]),
    ...facts.slots.flatMap((slot) => [
      slot.evidence.videos,
      slot.evidence.channels,
      slot.evidence.score,
      slot.evidence.scoredVideos,
      slot.hookSeconds,
    ]),
    facts.wordsPerMinute,
  ];
  return new Set(values.filter((value): value is number => value !== null));
}
