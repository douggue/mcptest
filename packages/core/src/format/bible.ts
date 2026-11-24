/**
 * The Format Bible an AI writes from a format's slots, in the shape of a
 * production teardown: rules, visual system, type, components, motion,
 * pacing, hook and chapters, titles, thumbnails, sound, a pipeline per layer,
 * a master prompt and what not to copy. The answer is checked with zod; a
 * colour role is kept only for a colour code measured in a slot, and every
 * number in its text that no fact holds is listed, so the reader knows.
 */
import { z } from 'zod';
import { liftJson } from '../teardown/stages';
import { knownNumbers, type BibleFacts } from './bibleFacts';
import { INGREDIENT_LAYERS, type IngredientLayer } from './types';

const line = (max: number) => z.string().trim().min(1).max(max);
const text = (max: number) => z.string().trim().max(max).default('');
const beat = z.object({ beat: line(80), does: text(400) });

export const bibleAnswerSchema = z.object({
  coreRules: z.array(line(400)).min(1).max(12),
  visualSystem: z
    .object({
      summary: text(1_500),
      roles: z
        .array(z.object({ hex: z.string().max(9), role: line(200) }))
        .max(12)
        .default([]),
    })
    .default({ summary: '', roles: [] }),
  typography: z
    .array(
      z.object({
        role: line(80),
        font: line(80),
        weight: text(40),
        casing: text(40),
        use: text(300),
      }),
    )
    .max(8)
    .default([]),
  components: z
    .array(z.object({ name: line(80), purpose: text(300), build: text(800) }))
    .max(12)
    .default([]),
  motion: z
    .array(z.object({ name: line(80), recipe: text(800) }))
    .max(12)
    .default([]),
  pacing: z.array(line(400)).max(12).default([]),
  hook: z.array(beat).max(10).default([]),
  chapters: z.array(beat).max(12).default([]),
  titleFormulas: z
    .array(z.object({ formula: line(200), example: text(200) }))
    .max(8)
    .default([]),
  thumbnails: z
    .array(z.object({ name: line(80), layout: text(500), prompt: text(1_200) }))
    .max(6)
    .default([]),
  sound: z.array(line(400)).max(10).default([]),
  pipeline: z
    .array(z.object({ layer: z.string().max(40), steps: z.array(line(300)).max(10) }))
    .max(INGREDIENT_LAYERS.length)
    .default([]),
  masterPrompt: line(4_000),
  doNotCopy: z.array(line(300)).max(10).default([]),
});

export type BibleWritten = Omit<z.output<typeof bibleAnswerSchema>, 'pipeline'> & {
  readonly pipeline: readonly { readonly layer: IngredientLayer; readonly steps: string[] }[];
};

/** A number in the AI's text that no fact holds, and the section it is in. */
export interface UnbackedNumber {
  readonly where: string;
  readonly number: number;
}

export interface FormatBible {
  /** The AI's words, as kept: its reading, never a measurement. */
  readonly written: BibleWritten;
  /** What code took from the slots when it was written. */
  readonly facts: BibleFacts;
  readonly engine: string;
  readonly writtenAt: string;
  /** What the answer said that was not kept, each with why. */
  readonly dropped: readonly string[];
  readonly unbacked: readonly UnbackedNumber[];
}

export type BibleCheck =
  | { readonly ok: true; readonly bible: FormatBible }
  | { readonly ok: false; readonly reason: string };

/** Integers this small are counts of things ("3 beats"), not measurements. */
export const SMALL_COUNT = 10;
const HEX_CODE = /#[0-9a-f]{3,8}\b/gi;
const NUMBER = /(?<![\w.])-?\d{1,3}(?:,\d{3})+(?:\.\d+)?(?!\d)|(?<![\w.])-?\d+(?:\.\d+)?/g;

/** The numbers in a text that are not small counts and not among the known ones, once each. */
export function unbackedNumbers(words: string, known: ReadonlySet<number>): number[] {
  const found = (words.replace(HEX_CODE, ' ').match(NUMBER) ?? []).map((raw) =>
    Number(raw.replace(/,/g, '')),
  );
  const unbacked = found.filter(
    (value) =>
      Number.isFinite(value) &&
      !(Number.isInteger(value) && Math.abs(value) <= SMALL_COUNT) &&
      !known.has(value),
  );
  return [...new Set(unbacked)];
}

type Answer = z.output<typeof bibleAnswerSchema>;

/** The AI's text of each section, by the name the Markdown gives it. */
function sectionTexts(written: BibleWritten): readonly (readonly [string, string])[] {
  const join = (parts: readonly string[]) => parts.join(' \n ');
  return [
    ['Core rules', join(written.coreRules)],
    ['Visual system', written.visualSystem.summary],
    [
      'Typography',
      join(written.typography.map((t) => `${t.role} ${t.font} ${t.weight} ${t.casing} ${t.use}`)),
    ],
    ['Component kit', join(written.components.map((c) => `${c.name} ${c.purpose} ${c.build}`))],
    ['Motion recipes', join(written.motion.map((m) => `${m.name} ${m.recipe}`))],
    ['Pacing rules', join(written.pacing)],
    [
      'Hook & chapter template',
      join([...written.hook, ...written.chapters].map((b) => `${b.beat} ${b.does}`)),
    ],
    ['Title formulas', join(written.titleFormulas.map((t) => `${t.formula} ${t.example}`))],
    ['Thumbnail layouts', join(written.thumbnails.map((t) => `${t.name} ${t.layout} ${t.prompt}`))],
    ['Sound & mix targets', join(written.sound)],
    ['Production pipeline', join(written.pipeline.flatMap((p) => p.steps))],
    ['Master prompt', written.masterPrompt],
    ['What not to copy', join(written.doNotCopy)],
  ];
}

function keptRoles(answer: Answer, facts: BibleFacts, dropped: string[]) {
  const measured = new Set(facts.palette.map((colour) => colour.hex));
  return answer.visualSystem.roles.flatMap((role) => {
    const hex = role.hex.trim().toUpperCase();
    if (measured.has(hex)) return [{ hex, role: role.role }];
    dropped.push(`${hex} was not measured in any slot, so its role was left out.`);
    return [];
  });
}

function keptPipeline(answer: Answer, dropped: string[]): BibleWritten['pipeline'] {
  return answer.pipeline.flatMap((part) => {
    const layer = INGREDIENT_LAYERS.find((name) => name === part.layer);
    if (layer !== undefined) return [{ layer, steps: part.steps }];
    dropped.push(`“${part.layer}” is not a layer, so its pipeline was left out.`);
    return [];
  });
}

export function checkBible(
  answer: string,
  facts: BibleFacts,
  engine: string,
  now: Date,
): BibleCheck {
  const parsed = bibleAnswerSchema.safeParse(liftJson(answer));
  if (!parsed.success) {
    return { ok: false, reason: 'the answer held no Format Bible in the form asked for' };
  }
  const dropped: string[] = [];
  const written: BibleWritten = {
    ...parsed.data,
    visualSystem: {
      summary: parsed.data.visualSystem.summary,
      roles: keptRoles(parsed.data, facts, dropped),
    },
    pipeline: keptPipeline(parsed.data, dropped),
  };
  const known = knownNumbers(facts);
  const unbacked = sectionTexts(written).flatMap(([where, words]) =>
    unbackedNumbers(words, known).map((number) => ({ where, number })),
  );
  return {
    ok: true,
    bible: { written, facts, engine, writtenAt: now.toISOString(), dropped, unbacked },
  };
}
