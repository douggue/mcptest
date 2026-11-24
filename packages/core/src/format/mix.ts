/**
 * Reads an AI's suggested mix: one JSON object naming, for each slot, an
 * ingredient on the shelf by its number and why, citing its evidence. Code
 * keeps only ingredients that are on the shelf and on that slot's layer, one
 * per layer; what it drops is listed with why. The reasons stay the AI's
 * reading; the numbers shown beside them come from the shelf.
 */
import { z } from 'zod';
import { liftJson } from '../teardown/stages';
import type { MixSuggestion, SuggestedSlot } from './formats';
import { INGREDIENT_LAYERS, type Ingredient } from './types';

export const MIX_REASON_CHARS = 300;
export const MIX_SUMMARY_CHARS = 1_200;

const answerSchema = z.object({
  summary: z.string().max(4_000).default(''),
  slots: z
    .array(
      z.object({
        layer: z.string().max(40),
        ingredient: z.number().int(),
        reason: z.string().max(2_000).default(''),
      }),
    )
    .max(40),
});

export type MixCheck =
  | { readonly ok: true; readonly suggestion: MixSuggestion }
  | { readonly ok: false; readonly reason: string };

const cut = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text.trim();

export function checkMix(
  answer: string,
  shelf: readonly Ingredient[],
  engine: string,
  now: Date,
): MixCheck {
  const parsed = answerSchema.safeParse(liftJson(answer));
  if (!parsed.success) return { ok: false, reason: 'the answer held no mix in the form asked for' };
  const byId = new Map(shelf.map((item) => [item.id, item]));
  const kept: SuggestedSlot[] = [];
  const dropped: string[] = [];
  for (const slot of parsed.data.slots) {
    const item = byId.get(slot.ingredient);
    const layer = INGREDIENT_LAYERS.find((name) => name === slot.layer);
    if (layer === undefined) dropped.push(`“${cut(slot.layer, 40)}” is not a layer.`);
    else if (item === undefined) dropped.push(`Ingredient ${slot.ingredient} is not on the shelf.`);
    else if (item.layer !== layer) dropped.push(`“${item.name}” is not a ${layer} ingredient.`);
    else if (kept.some((other) => other.layer === layer))
      dropped.push(`A second ${layer} was left out.`);
    else kept.push({ layer, ingredientId: item.id, reason: cut(slot.reason, MIX_REASON_CHARS) });
  }
  if (kept.length === 0) return { ok: false, reason: 'no slot named an ingredient on the shelf' };
  return {
    ok: true,
    suggestion: {
      slots: kept,
      summary: cut(parsed.data.summary, MIX_SUMMARY_CHARS),
      dropped,
      engine,
      writtenAt: now.toISOString(),
    },
  };
}
