import { readBlocks, single } from '../labelled';
import { VIDEO_ID_PATTERN } from '../sources/parse';
import { HEADING_LINE } from './measure';
import { SCRIPT_HOOKS, type ScriptHook } from './types';

/**
 * Reads what an engine wrote in each stage of a script. The first stage
 * answers in a fixed labelled form (three hooks, then a beat sheet); the
 * other two answer with the script itself. As with every other answer,
 * nothing is guessed: a hook without its words is not a hook.
 */

/** The most a hook's way of opening is named in: a few words. */
const MAX_WAY_CHARS = 80;
/** A one-minute hook is some 150 to 200 words; this leaves room for a fast voice. */
const MAX_HOOK_CHARS = 3000;
const MAX_BEAT_CHARS = 400;
/** The most beats a sheet may hold: a beat every half minute of an hour-long video. */
const MAX_BEATS = 120;

const LABELS = ['WAY', 'MODEL', 'TEXT', 'BEAT'] as const;
const HOOK_HEADING = /^HOOK\s+\d\s*:?$/;
const BEATS_HEADING = /^BEATS?\s*:?$/;

export interface HooksAndBeats {
  readonly hooks: readonly ScriptHook[];
  /** One beat to a line, as written: a time, a name and what happens, set apart by "|". */
  readonly beats: readonly string[];
  /** Why the answer cannot be used, in plain words; null when it can. */
  readonly problem: string | null;
}

function hookOf(block: ReadonlyMap<string, readonly string[]>): ScriptHook | null {
  const way = single(block, 'WAY');
  const text = single(block, 'TEXT');
  if (!way || !text || way.length > MAX_WAY_CHARS || text.length > MAX_HOOK_CHARS) return null;
  const model = (single(block, 'MODEL') ?? '').match(/(?<![\w-])[\w-]{11}(?![\w-])/)?.[0] ?? null;
  return { way, model: model !== null && VIDEO_ID_PATTERN.test(model) ? model : null, text };
}

/** The hooks and the beat sheet of a first-stage answer. */
export function parseHooksAndBeats(answer: string): HooksAndBeats {
  const blocks = readBlocks(answer, {
    labels: LABELS,
    opens: (line) => HOOK_HEADING.test(line) || BEATS_HEADING.test(line),
  });
  const hooks = blocks
    .filter((block) => block.has('TEXT') || block.has('WAY'))
    .map(hookOf)
    .filter((hook): hook is ScriptHook => hook !== null)
    .slice(0, SCRIPT_HOOKS);
  const beats = blocks
    .flatMap((block) => block.get('BEAT') ?? [])
    .filter((beat) => beat !== '' && beat.length <= MAX_BEAT_CHARS)
    .slice(0, MAX_BEATS);
  const problem =
    hooks.length === 0
      ? 'It holds no hook that could be read: each needs its way of opening and its words.'
      : beats.length === 0
        ? 'It holds no beat sheet.'
        : null;
  return { hooks, beats, problem };
}

const FENCE = /^```/;

/**
 * The script in a second- or third-stage answer: from its first heading to
 * its end, without anything said before it and without code fences. An
 * answer with no heading is taken whole.
 */
export function scriptBody(answer: string): string {
  const lines = answer.split('\n').filter((line) => !FENCE.test(line.trim()));
  const first = lines.findIndex((line) => HEADING_LINE.test(line.trim()));
  return lines.slice(Math.max(first, 0)).join('\n').trim();
}

/** One line of a beat sheet. */
export interface Beat {
  /** When it starts, as written, such as 1:00; empty when the line gives none. */
  readonly time: string;
  readonly name: string;
  /** What happens in it; empty when the line gives none. */
  readonly what: string;
}

const TIME = /^\d{1,2}:\d{2}(?::\d{2})?$/;

/** A beat sheet's lines as beats. A line without a time is a beat with none. */
export function readBeats(beats: string): readonly Beat[] {
  return beats
    .split('\n')
    .map((line) => line.split('|').map((part) => part.trim()))
    .filter((parts) => parts.some((part) => part !== ''))
    .map((parts): Beat => {
      const timed = TIME.test(parts[0] ?? '');
      const [name = '', ...rest] = timed ? parts.slice(1) : parts;
      return { time: timed ? (parts[0] ?? '') : '', name, what: rest.join(' | ') };
    });
}
