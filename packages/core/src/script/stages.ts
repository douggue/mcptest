import { readBlocks, single, unmarked } from '../labelled';
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
/**
 * The most one beat is kept in. A beat is asked for in about 45 words; a
 * real run wrote up to 946 characters, so there is room for that. A longer
 * one is shortened and reported, never dropped: a sheet that silently loses
 * beats becomes a script that silently loses a third of its length.
 */
export const MAX_BEAT_CHARS = 1200;
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
  /** What was changed while reading it (a beat shortened, beats left off), for the owner to see. */
  readonly notes: readonly string[];
}

function hookOf(block: ReadonlyMap<string, readonly string[]>): ScriptHook | null {
  const way = single(block, 'WAY');
  const text = single(block, 'TEXT');
  if (!way || !text || way.length > MAX_WAY_CHARS || text.length > MAX_HOOK_CHARS) return null;
  const model = (single(block, 'MODEL') ?? '').match(/(?<![\w-])[\w-]{11}(?![\w-])/)?.[0] ?? null;
  return { way, model: model !== null && VIDEO_ID_PATTERN.test(model) ? model : null, text };
}

const SENTENCE_END = /[.!?](?=\s|$)/g;

/**
 * A text within `max` characters: as it is when it fits, else cut after the
 * last sentence that fits, or at a word with a mark that it goes on.
 */
export function shortened(text: string, max: number): string {
  if (text.length <= max) return text;
  const room = text.slice(0, max);
  const ends = [...room.matchAll(SENTENCE_END)].map((match) => match.index + 1);
  const last = ends.at(-1);
  // A cut that would lose most of the text is no sentence boundary worth taking.
  if (last !== undefined && last >= max / 2) return room.slice(0, last);
  const words = room.slice(0, max - 1);
  return `${words.slice(0, Math.max(words.lastIndexOf(' '), 1)).trimEnd()}…`;
}

/**
 * A beat line however it was labelled: "BEAT 4:", "Beat 4 -", "4." or "4)"
 * before the time, or the time with no label at all.
 */
const LOOSE_BEAT =
  /^(?:BEAT\s*\d*\s*[:.)\-–]?\s*|\d+\s*[.)]\s+)?(\d{1,2}:\d{2}(?::\d{2})?\s*\|.*)$/i;

/**
 * The answer with every beat line under the BEATS heading given the label it
 * was asked for. Without this, a beat written as "BEAT 4: 4:00 | …" or with
 * no label reads as more of the beat above it, and two beats become one.
 */
function withBeatLabels(answer: string): string {
  let inBeats = false;
  return answer
    .split('\n')
    .map((raw) => {
      const line = unmarked(raw);
      if (BEATS_HEADING.test(line)) inBeats = true;
      else if (HOOK_HEADING.test(line)) inBeats = false;
      const beat = inBeats ? LOOSE_BEAT.exec(line)?.[1] : undefined;
      return beat === undefined ? raw : `BEAT: ${beat}`;
    })
    .join('\n');
}

/** The hooks and the beat sheet of a first-stage answer. */
export function parseHooksAndBeats(answer: string): HooksAndBeats {
  const blocks = readBlocks(withBeatLabels(answer), {
    labels: LABELS,
    opens: (line) => HOOK_HEADING.test(line) || BEATS_HEADING.test(line),
  });
  const hooks = blocks
    .filter((block) => block.has('TEXT') || block.has('WAY'))
    .map(hookOf)
    .filter((hook): hook is ScriptHook => hook !== null)
    .slice(0, SCRIPT_HOOKS);
  const written = blocks.flatMap((block) => block.get('BEAT') ?? []).filter((beat) => beat !== '');
  const kept = written.slice(0, MAX_BEATS);
  const beats = kept.map((beat) => shortened(beat, MAX_BEAT_CHARS));
  const notes = [
    ...kept.flatMap((beat, at) =>
      beat.length > MAX_BEAT_CHARS
        ? [
            `Beat ${at + 1} (“${readBeats(beat)[0]?.name ?? ''}”) was longer than a beat sheet keeps, so it was shortened at the end of a sentence. Read it and put back what matters.`,
          ]
        : [],
    ),
    ...(written.length > MAX_BEATS
      ? [`The AI wrote ${written.length} beats; a beat sheet keeps the first ${MAX_BEATS}.`]
      : []),
  ];
  const problem =
    hooks.length === 0
      ? 'It holds no hook that could be read: each needs its way of opening and its words.'
      : beats.length === 0
        ? 'It holds no beat sheet.'
        : null;
  return { hooks, beats, problem, notes };
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
