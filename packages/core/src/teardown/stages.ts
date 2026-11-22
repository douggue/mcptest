import { z } from 'zod';

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
  | { readonly ok: true; readonly data: StageData<S> }
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

const MAX_ISSUES = 3;

/** One stage's answer, checked; why it was refused when it does not fit. */
export function checkStage<S extends TeardownStage>(stage: S, answer: string): StageCheck<S> {
  const lifted = liftJson(answer);
  if (lifted === null) return { ok: false, reason: 'the answer held no JSON object' };
  const parsed = stageSchemas[stage].safeParse(lifted);
  if (parsed.success) return { ok: true, data: parsed.data as StageData<S> };
  const issues = parsed.error.issues
    .slice(0, MAX_ISSUES)
    .map((issue) => `${issue.path.join('.') || 'the answer'}: ${issue.message}`);
  return { ok: false, reason: `the answer did not fit the form asked for (${issues.join('; ')})` };
}
