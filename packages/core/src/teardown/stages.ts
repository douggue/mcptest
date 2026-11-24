import { z } from 'zod';
import { shortened } from '../script/stages';

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

const MAX_ISSUES = 3;
/** How many times an answer is repaired and checked again: a repair can uncover the next thing wrong. */
const REPAIR_ROUNDS = 6;
/** Lists whose entries are checked one by one: a bad entry is dropped, the list stays. */
const TYPED_LISTS = ['at', 'hexes', 'strips'];
/** A time an item cannot do without: an item whose time cannot be read is left out. */
const ITEM_TIMES = ['start', 'end', 'at'];
const MOTION_KINDS = ['transition', 'text', 'graphic', 'camera', 'other'];

type Path = readonly PropertyKey[];
interface Issue {
  readonly code?: string;
  readonly path: Path;
  readonly message: string;
  readonly origin?: string;
  readonly maximum?: number | bigint;
}

const isIndex = (key: PropertyKey | undefined): key is number => typeof key === 'number';

/** Where in the answer something is, in words: "items 2, description". */
const placeOf = (path: Path): string =>
  path
    .map((key, at) => (isIndex(key) ? ` ${key + 1}` : `${at === 0 ? '' : ', '}${String(key)}`))
    .join('');

/** What sits at a path of the answer; undefined when the path leads nowhere. */
function at(root: unknown, path: Path): unknown {
  return path.reduce<unknown>(
    (value, key) =>
      typeof value === 'object' && value !== null
        ? (value as Record<PropertyKey, unknown>)[key]
        : undefined,
    root,
  );
}

/** Puts a value at a path of the answer. */
function put(root: unknown, path: Path, value: unknown): void {
  const holder = at(root, path.slice(0, -1));
  const key = path.at(-1);
  if (typeof holder === 'object' && holder !== null && key !== undefined) {
    (holder as Record<PropertyKey, unknown>)[key] = value;
  }
}

/** A repair to make: the array an entry is taken out of, or a value to set. */
type Repair =
  | { readonly drop: Path; readonly note: string }
  | { readonly set: Path; readonly value: unknown; readonly note: string };

/** The repair that answers one thing wrong, or null when nothing honest can be done about it. */
function repairOf(root: unknown, issue: Issue): Repair | null {
  const { path } = issue;
  const last = path.at(-1);
  const parent = path.at(-2);
  const value = at(root, path);
  const where = placeOf(path);
  const max = Number(issue.maximum);
  if (issue.code === 'too_big' && typeof value === 'string' && Number.isFinite(max)) {
    return { set: path, value: shortened(value, max), note: `${where}: shortened to fit.` };
  }
  if (issue.code === 'too_big' && Array.isArray(value) && Number.isFinite(max)) {
    return {
      set: path,
      value: value.slice(0, max),
      note: `${where}: only the first ${max} are kept.`,
    };
  }
  if (isIndex(last) && typeof parent === 'string' && TYPED_LISTS.includes(parent)) {
    return {
      drop: path,
      note: `${placeOf(path.slice(0, -1))}: one entry could not be read, so it was left out.`,
    };
  }
  if (last === 'keyframe') {
    return { set: path, value: null, note: `${where}: not a keyframe name, so left empty.` };
  }
  if (last === 'kind' && !MOTION_KINDS.includes(String(value))) {
    return { set: path, value: 'other', note: `${where}: not one of the kinds, so set to other.` };
  }
  if (last === 'method' && path.at(-2) === 'rebuild' && isIndex(path.at(-3))) {
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
  return null;
}

/**
 * The answer with what is wrong repaired, where it can be: a text too long
 * shortened at a sentence, a list too long cut to its size, a bad entry of a
 * typed list or an item with an unreadable time left out, a keyframe that is
 * none set to none. Nothing is made up: what is required and missing stays
 * missing, and the stage is then refused. Null when an issue has no repair.
 */
function repairedOnce(root: unknown, issues: readonly Issue[]): readonly string[] | null {
  const repairs = issues.map((issue) => repairOf(root, issue));
  if (repairs.some((repair) => repair === null)) return null;
  const made = repairs as readonly Repair[];
  for (const repair of made) if ('set' in repair) put(root, repair.set, repair.value);
  // Entries are taken out from the end of a list first, so the places of the others hold.
  const drops = made
    .flatMap((repair) => ('drop' in repair ? [repair.drop] : []))
    .filter(
      (path, index, all) => all.findIndex((other) => other.join('/') === path.join('/')) === index,
    )
    .sort((a, b) => b.length - a.length || Number(b.at(-1)) - Number(a.at(-1)));
  for (const path of drops) {
    const list = at(root, path.slice(0, -1));
    const index = path.at(-1);
    if (Array.isArray(list) && isIndex(index)) list.splice(index, 1);
  }
  return [...new Set(made.map((repair) => repair.note))];
}

const reasonOf = (issues: readonly Issue[]): string =>
  `the answer did not fit the form asked for (${issues
    .slice(0, MAX_ISSUES)
    .map((issue) => `${issue.path.join('.') || 'the answer'}: ${issue.message}`)
    .join('; ')})`;

/**
 * One stage's answer, checked. An answer with a field too long or a typed
 * entry that is not one is repaired and kept, with what was done; it is
 * refused, with where it went wrong, only when nothing honest can repair it.
 */
export function checkStage<S extends TeardownStage>(stage: S, answer: string): StageCheck<S> {
  const lifted = liftJson(answer);
  if (lifted === null) return { ok: false, reason: 'the answer held no JSON object' };
  const first = stageSchemas[stage].safeParse(lifted);
  if (first.success) return { ok: true, data: first.data as StageData<S>, repaired: [] };
  const refused = { ok: false as const, reason: reasonOf(first.error.issues) };
  const working: unknown = structuredClone(lifted);
  let issues: readonly Issue[] = first.error.issues;
  const repaired: string[] = [];
  for (let round = 0; round < REPAIR_ROUNDS; round += 1) {
    const notes = repairedOnce(working, issues);
    if (notes === null) return refused;
    repaired.push(...notes);
    const again = stageSchemas[stage].safeParse(working);
    if (again.success) return { ok: true, data: again.data as StageData<S>, repaired };
    issues = again.error.issues;
  }
  return refused;
}
