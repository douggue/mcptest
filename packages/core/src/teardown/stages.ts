import { z } from 'zod';
import {
  fitToSchema,
  isIndex,
  placeOf,
  valueAt,
  type Issue,
  type Repair,
  type RepairRules,
} from '../repair';

/**
 * What each judged stage of a teardown answers, as checked JSON. An engine is
 * asked for one JSON object per stage; whatever it writes is checked against
 * the stage's schema here and refused when it does not fit, so the page never
 * shows prose where a table was asked for. Times may come as seconds or as
 * "m:ss"; they are kept as seconds.
 */

export const TEARDOWN_STAGES = [
  'structure',
  'watch',
  'hook',
  'design',
  'archetypes',
  'techniques',
  'motion',
  'sound',
  'plan',
] as const;
export type TeardownStage = (typeof TEARDOWN_STAGES)[number];

const SHORT = 200;
const LINE = 600;
const LONG = 4000;
const PROMPT = 6000;

const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().trim().max(max).default('');

/** Seconds as a number or as "h:mm:ss" / "m:ss" text. */
export function secondsOf(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : null;
  if (typeof value !== 'string') return null;
  const parts = value
    .trim()
    .replace(/^\[|\]$/g, '')
    .split(':');
  if (parts.length > 3 || parts.some((part) => !/^\d+(?:\.\d+)?$/.test(part))) return null;
  return parts.reduce((total, part) => total * 60 + Number(part), 0);
}

const time = z.unknown().transform((value, context) => {
  const seconds = secondsOf(value);
  if (seconds === null) {
    context.addIssue({ code: 'custom', message: 'a time must be seconds or m:ss' });
    return z.NEVER;
  }
  return Math.round(seconds * 10) / 10;
});
const times = z.array(time).max(30).default([]);
const span = { start: time, end: time };

export const stageSchemas = {
  structure: z.object({
    format: text(LINE),
    summary: text(LONG),
    chapters: z
      .array(z.object({ ...span, title: text(SHORT), role: text(SHORT), summary: text(LINE) }))
      .min(1)
      .max(12),
  }),
  watch: z.object({
    voice: optionalText(LINE),
    chapters: z
      .array(
        z.object({
          ...span,
          visuals: optionalText(LONG),
          sound: optionalText(LONG),
          music: optionalText(LINE),
          sfx: z.array(text(LINE)).max(20).default([]),
          techniques: z.array(text(LINE)).max(20).default([]),
        }),
      )
      .max(12)
      .default([]),
    sync: z
      .array(z.object({ at: time, motion: text(LINE), sound: text(LINE) }))
      .max(30)
      .default([]),
    hook: z
      .array(z.object({ ...span, sound: text(LINE) }))
      .max(20)
      .default([]),
    transcript: z
      .array(z.object({ at: time, text: text(LINE) }))
      .max(4000)
      .default([]),
  }),
  hook: z.object({
    summary: text(LONG),
    rows: z
      .array(
        z.object({
          ...span,
          visual: text(LINE),
          camera: optionalText(SHORT),
          onScreenText: optionalText(LINE),
        }),
      )
      .min(1)
      .max(20),
  }),
  design: z.object({
    colourModes: z
      .array(
        z.object({
          name: text(SHORT),
          hexes: z.array(z.string().regex(/^#?[0-9a-fA-F]{6}$/)).max(8),
          use: text(LINE),
        }),
      )
      .max(8),
    typography: z
      .array(
        z.object({
          role: text(SHORT),
          style: text(LINE),
          casing: optionalText(SHORT),
          examples: z.array(text(SHORT)).max(6).default([]),
        }),
      )
      .max(8),
    motion: z.array(z.object({ name: text(SHORT), description: text(LINE), at: times })).max(12),
  }),
  archetypes: z.object({
    items: z
      .array(
        z.object({
          name: text(SHORT),
          description: text(LINE),
          keyframe: z
            .string()
            .regex(/^k-\d{3}$/)
            .nullable()
            .default(null),
          at: times,
          buildWith: text(SHORT),
        }),
      )
      .min(1)
      .max(16),
  }),
  techniques: z.object({
    items: z
      .array(
        z.object({
          name: text(SHORT),
          description: text(LINE),
          quotes: z
            .array(z.object({ text: text(LINE), at: time }))
            .max(6)
            .default([]),
        }),
      )
      .min(1)
      .max(12),
  }),
  sound: z.object({
    voice: text(LINE),
    music: text(LINE),
    sfx: z.array(z.object({ cue: text(SHORT), description: text(LINE), at: times })).max(12),
    mix: text(LINE),
  }),
  motion: z.object({
    items: z
      .array(
        z.object({
          name: text(SHORT),
          kind: z.enum(['transition', 'text', 'graphic', 'camera', 'other']),
          strips: z
            .array(z.string().regex(/^s-\d{3}$/))
            .max(6)
            .default([]),
          at: times,
          easing: optionalText(SHORT),
          rebuild: z.object({
            method: z.enum(['code', 'ai-video', 'editor', 'stock']),
            recipe: text(LINE),
          }),
        }),
      )
      .min(1)
      .max(20),
  }),
  plan: z.object({
    layers: z
      .array(z.object({ layer: text(SHORT), toolType: text(SHORT), produces: text(LINE) }))
      .min(1)
      .max(10),
    components: z
      .array(z.object({ name: text(SHORT), archetype: text(SHORT), buildWith: text(SHORT) }))
      .max(16),
    workflow: z.array(text(LINE)).min(1).max(16),
    prompts: z.object({
      script: text(PROMPT),
      visuals: z
        .array(z.object({ archetype: text(SHORT), prompt: text(PROMPT) }))
        .max(16)
        .default([]),
      thumbnail: text(PROMPT),
    }),
    avoid: z.array(text(LINE)).min(1).max(12),
  }),
} as const;

export type StageData<S extends TeardownStage> = z.output<(typeof stageSchemas)[S]>;

export type StageCheck<S extends TeardownStage> =
  | {
      readonly ok: true;
      readonly data: StageData<S>;
      /** What was shortened or left out so that the rest could be kept; empty when the answer fitted. */
      readonly repaired: readonly string[];
    }
  | { readonly ok: false; readonly reason: string };

/** The JSON object in an answer: the whole answer, or what sits in a code fence or between the outer braces. */
export function liftJson(answer: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(answer)?.[1];
  const candidates = [answer.trim(), fenced?.trim() ?? ''];
  const first = answer.indexOf('{');
  const last = answer.lastIndexOf('}');
  if (first !== -1 && last > first) candidates.push(answer.slice(first, last + 1));
  for (const candidate of candidates) {
    if (candidate === '') continue;
    try {
      return JSON.parse(candidate) as unknown;
    } catch {
      // Not this one; the next is tried.
    }
  }
  return null;
}

/** The key a stored stage carries its repairs under, beside what was judged. */
export const REPAIRED_KEY = 'repaired';

/** Lists whose entries are checked one by one: a bad entry is dropped, the list stays. */
const TYPED_LISTS = ['at', 'hexes', 'strips'];
/** A time an item cannot do without: an item whose time cannot be read is left out. */
const ITEM_TIMES = ['start', 'end', 'at'];
const MOTION_KINDS = ['transition', 'text', 'graphic', 'camera', 'other'];
/**
 * Required texts that are never filled with "not stated" when left empty: a
 * name the page lists by, a ready prompt the owner pastes, a line quoted
 * from the transcript. Left empty, the stage is refused, naming the field.
 */
const NEVER_UNSTATED = ['name', 'title', 'script', 'thumbnail', 'prompt', 'text', 'keyframe'];

/** The repairs only a teardown stage knows. */
function stageRepair(root: unknown, issue: Issue): Repair | null | undefined {
  const { path } = issue;
  const last = path.at(-1);
  const parent = path.at(-2);
  const value = valueAt(root, path);
  const where = placeOf(path);
  if (last === 'keyframe') {
    return { set: path, value: null, note: `${where}: not a keyframe name, so left empty.` };
  }
  if (last === 'kind' && value !== undefined && !MOTION_KINDS.includes(String(value))) {
    return { set: path, value: 'other', note: `${where}: not one of the kinds, so set to other.` };
  }
  if (last === 'method' && parent === 'rebuild' && isIndex(path.at(-3))) {
    const item = path.slice(0, -2);
    return {
      drop: item,
      note: `${placeOf(item)}: its way to rebuild was none of code, ai-video, editor or stock, so it was left out.`,
    };
  }
  if (typeof last === 'string' && ITEM_TIMES.includes(last) && isIndex(parent)) {
    const item = path.slice(0, -1);
    return {
      drop: item,
      note: `${placeOf(item)}: its time could not be read, so it was left out.`,
    };
  }
  return undefined;
}

const STAGE_RULES: RepairRules = {
  typedLists: TYPED_LISTS,
  special: stageRepair,
  mayBeUnstated: (path) => !NEVER_UNSTATED.includes(String(path.at(-1))),
};

/**
 * One stage's answer, checked. An answer with a field too long, a null where
 * a text may be left out, or a typed entry that is not one is repaired and
 * kept, with what was done; it is refused, with where it went wrong, only
 * when nothing honest can repair it.
 */
export function checkStage<S extends TeardownStage>(stage: S, answer: string): StageCheck<S> {
  const lifted = liftJson(answer);
  if (lifted === null) return { ok: false, reason: 'the answer held no JSON object' };
  const fitted = fitToSchema(stageSchemas[stage], lifted, STAGE_RULES);
  return fitted.ok
    ? { ok: true, data: fitted.data as StageData<S>, repaired: fitted.repaired }
    : fitted;
}
