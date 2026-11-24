/**
 * A kept Format Bible, checked again with a schema when it is read from the
 * store: a Bible that no longer reads is none.
 */
import { z } from 'zod';
import { bibleAnswerSchema, type FormatBible } from './bible';
import { INGREDIENT_LAYERS } from './types';

const LAYER = z.enum(INGREDIENT_LAYERS);
const evidence = z.object({
  score: z.number().nullable(),
  scoredVideos: z.number(),
  videos: z.number().nullable(),
  channels: z.number().nullable(),
  measured: z.array(
    z.object({ label: z.string(), value: z.number(), unit: z.string(), method: z.string() }),
  ),
});
const ref = z.union([
  z.object({ kind: z.literal('teardown'), videoId: z.string(), file: z.string() }),
  z.object({ kind: z.literal('image'), file: z.string() }),
]);

const factsSchema = z.object({
  format: z.object({
    name: z.string(),
    targetSeconds: z.number().nullable(),
    notes: z.string(),
  }),
  slots: z.array(
    z.object({
      layer: LAYER,
      ingredientId: z.number(),
      name: z.string(),
      from: z.string(),
      proven: z.boolean(),
      evidence,
      note: z.string(),
      hookSeconds: z.number().nullable(),
    }),
  ),
  measured: z.array(
    z.object({
      layer: LAYER,
      from: z.string(),
      label: z.string(),
      value: z.number(),
      unit: z.string(),
      method: z.string(),
    }),
  ),
  palette: z.array(z.object({ hex: z.string(), share: z.number(), from: z.string() })),
  titleFormulas: z.array(
    z.object({
      formula: z.string(),
      videos: z.number().nullable(),
      channels: z.number().nullable(),
      score: z.number().nullable(),
    }),
  ),
  wordsPerMinute: z.number().nullable(),
  typography: z.array(
    z.object({ role: z.string(), style: z.string(), casing: z.string().nullable() }),
  ),
  pictures: z.array(z.object({ name: z.string(), ingredientId: z.number(), ref })),
});

export const storedBibleSchema: z.ZodType<FormatBible> = z.object({
  written: bibleAnswerSchema.extend({
    pipeline: z.array(z.object({ layer: LAYER, steps: z.array(z.string()) })),
  }),
  facts: factsSchema,
  engine: z.string().min(1).max(40),
  writtenAt: z.string().min(1).max(40),
  dropped: z.array(z.string()),
  unbacked: z.array(z.object({ where: z.string(), number: z.number() })),
}) as z.ZodType<FormatBible>;
