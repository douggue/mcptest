import type { TypedLength } from './scriptLength';
import type { LengthRange, ScriptFields, VoiceProfile } from '@jgtube/core';
import { parseCues, shotListCsv } from '@jgtube/core/src/script/cues';
import {
  checkMarkers,
  cleanVoiceover,
  stripCheckMarkers,
  countWords,
  figuresWithoutCheck,
  readingGrade,
  spokenSeconds,
  type CheckMarker,
} from '@jgtube/core/src/script/measure';
import { readBeats } from '@jgtube/core/src/script/stages';
import { MAX_HOOK_MODELS } from '@jgtube/core/src/script/types';
import type { Answered, ConceptView } from './ideaLab';

/**
 * The script writer as the page reads it: a concept's script, the numbers it
 * is written to, and everything the page counts about the text in the
 * editor. Every number here is counted in code from the text itself; none is
 * taken from the AI that wrote it. The shapes of what the server answers are
 * the server's.
 */

export type ScriptStage = 'hooks' | 'draft' | 'tighten';

export interface StoredScript extends ScriptFields {
  readonly conceptId: number;
  readonly centerChannelId: string;
  readonly updatedAt: string;
}

export interface VoiceView {
  readonly channelId: string;
  readonly title: string;
  readonly profile: VoiceProfile;
  readonly toRead: number;
  readonly noCaptions: number;
  readonly frameStudies: readonly string[];
}

export interface ScriptView {
  readonly concept: ConceptView;
  readonly script: StoredScript | null;
  readonly plan: {
    readonly hookSeconds: number;
    readonly hookWords: number | null;
    readonly targetWords: number | null;
  };
  readonly lengthRange: LengthRange | null;
  readonly voice: VoiceView | null;
  /** Whether the owner has facts marked for checking (a setting); absent from an older server means yes. */
  readonly markFacts?: boolean;
  /** Which length field the owner typed last; absent from an older server. */
  readonly typedLength?: TypedLength | null;
  /** The sections of the draft under 85% of their words, counted by the server; absent from an older one. */
  readonly shortSections?: readonly ShortSection[];
  /** The draft was written from an older beat sheet and is to be written again; absent from an older server. */
  readonly draftStale?: boolean;
}

/** A section of the draft that came out short: the words it has and the words it was to hold. */
export interface ShortSection {
  readonly section: string;
  readonly words: number;
  readonly budget: number;
  /** The beat has no section in the draft at all. */
  readonly missing?: true;
}

/** One short section in a line: its name, its words against its number, and how far it got. */
export function shortSectionLine(section: ShortSection): string {
  if (section.missing)
    return `${section.section}: missing from the draft (${section.budget} words)`;
  const share = section.budget > 0 ? Math.round((section.words / section.budget) * 100) : 0;
  return `${section.section}: ${section.words} of ${section.budget} words (${share}%)`;
}

export interface ScriptOutcome extends Answered {
  readonly kind: 'script';
  readonly stage: ScriptStage;
  readonly view: ScriptView;
  /** What changed while the answer was read (a beat shortened, beats left off); absent from an older server. */
  readonly notes?: readonly string[];
}

export interface VoiceOutcome {
  readonly kind: 'voice';
  readonly voice: VoiceView;
  readonly read: number;
  readonly failed: readonly { readonly videoId: string; readonly reason: string }[];
}

/** What the page counts about the text in the editor. */
export interface ScriptStats {
  readonly words: number;
  /** How long the words take at the rate; null without a rate. */
  readonly seconds: number | null;
  /** The reading grade (an estimate, English only); null when it cannot be told. */
  readonly grade: number | null;
  /** The facts still marked to be checked. */
  readonly markers: readonly CheckMarker[];
  /** Sentences that hold a figure and no marker: worth a second look. */
  readonly unmarkedFigures: readonly string[];
  /** How many picture cues the text holds. */
  readonly cues: number;
}

/** Any rate will do to count the picture cues: the rate only times them. */
const COUNTING_RATE = 150;

/** Everything counted about a script's text at a speaking rate. Cue lines, headings and markers are not words. */
export function scriptStats(
  text: string,
  wordsPerMinute: number | null,
  /** False when the owner has turned the marking of facts off: nothing is listed to check. */
  markFacts = true,
): ScriptStats {
  const words = countWords(text);
  return {
    words,
    seconds: wordsPerMinute === null ? null : spokenSeconds(words, wordsPerMinute),
    grade: readingGrade(text),
    markers: markFacts ? checkMarkers(text) : [],
    unmarkedFigures: markFacts ? figuresWithoutCheck(text) : [],
    cues: parseCues(text, wordsPerMinute ?? COUNTING_RATE).length,
  };
}

/** A length of time as minutes and seconds, such as 12:05; a dash when it is not known. */
export function clockOf(seconds: number | null): string {
  if (seconds === null) return '—';
  return `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`;
}

/** The reading grade beside the voice's own, in plain words. */
export function gradeNote(grade: number | null, voiceGrade: number | null): string {
  if (grade === null) {
    return 'No reading grade: the text is too short, has no sentence ends, or is not in Latin script.';
  }
  const own = `Reading grade ${grade.toFixed(1)} (an estimate, for English).`;
  if (voiceGrade === null) return `${own} The voice channel’s own grade is not known.`;
  const gap = grade - voiceGrade;
  const against =
    Math.abs(gap) < 1
      ? 'about the same as'
      : gap > 0
        ? `${gap.toFixed(1)} harder than`
        : `${(-gap).toFixed(1)} easier than`;
  return `${own} That is ${against} the voice channel’s ${voiceGrade.toFixed(1)}.`;
}

export interface ChecklistItem {
  /** When the beat starts, as the sheet gives it; empty when it gives none. */
  readonly time: string;
  readonly name: string;
  /** The text has a part headed with this beat's name. */
  readonly done: boolean;
}

const headingsOf = (text: string): readonly string[] =>
  text
    .split('\n')
    .flatMap((line) => /^##\s+(.*)$/.exec(line.trim())?.[1] ?? [])
    .map((heading) => heading.trim().toLowerCase());

/**
 * A checklist from the beat sheet: the hook, then each beat, ticked when the
 * text has a part headed with its name.
 */
export function checklist(beats: string, text: string): readonly ChecklistItem[] {
  const headings = headingsOf(text);
  const has = (name: string): boolean => headings.includes(name.trim().toLowerCase());
  return [
    { time: '0:00', name: 'Hook', done: has('hook') },
    ...readBeats(beats).map((beat) => ({ time: beat.time, name: beat.name, done: has(beat.name) })),
  ];
}

/** Which stages can be run, and which have been. */
export interface StageState {
  readonly stage: ScriptStage;
  readonly done: boolean;
  /** Why it cannot be run yet, in plain words; null when it can. */
  readonly blocked: string | null;
}

export function stageStates(script: StoredScript | null): readonly StageState[] {
  const setUp =
    script === null || script.wordsPerMinute === null
      ? 'Set a speaking rate first: choose a voice whose captions have been read, or type a rate.'
      : script.targetSeconds === null
        ? 'Choose how long the video is to be first.'
        : null;
  const planned = script !== null && script.chosenHook.trim() !== '' && script.beats.trim() !== '';
  const drafted = script !== null && script.draft.trim() !== '';
  return [
    { stage: 'hooks', done: (script?.hooks.length ?? 0) > 0, blocked: setUp },
    {
      stage: 'draft',
      done: drafted,
      blocked: setUp ?? (planned ? null : 'Choose one of the hooks and keep a beat sheet first.'),
    },
    {
      stage: 'tighten',
      done: script !== null && script.tightened.trim() !== '',
      blocked: setUp ?? (drafted ? null : 'There is no draft to tighten yet.'),
    },
  ];
}

/** The step to show first: the first one not written, or the last when every one is. */
export const openingStep = (states: readonly StageState[]): ScriptStage =>
  states.find((state) => !state.done)?.stage ?? 'tighten';

/** A file name from a title: its letters and digits, with dashes between. */
export function exportName(title: string, extension: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${base || 'script'}.${extension}`;
}

/** The whole script as a plain text file: the title, then the text with its headings, cues and markers. */
export function exportText(title: string, text: string, markFacts = true): string {
  const body = markFacts ? text : stripCheckMarkers(text);
  return `${title}\n\n${body.trim()}\n`;
}

export interface MarkdownExtras {
  /** The concept's thumbnail prompt, added at the end under its own heading. */
  readonly thumbnailPrompt?: string | null;
  /** The numbered source list of the facts the script names, last of all. */
  readonly sources?: readonly string[];
}

/** What follows the script in the file: the concept's thumbnail prompt when it has one. */
const extrasOf = ({ thumbnailPrompt, sources = [] }: MarkdownExtras): readonly string[] => [
  ...(thumbnailPrompt ? ['## Thumbnail prompt', '', thumbnailPrompt.trim(), ''] : []),
  ...sources,
];

/**
 * The whole script as a Markdown file: the title as a heading, the text with
 * its headings, cues and markers as written, then the facts still to check
 * as a list, so the markers travel with the script.
 */
export function exportMarkdown(
  title: string,
  text: string,
  markFacts = true,
  extras: MarkdownExtras = {},
): string {
  // With the marking of facts turned off, the file carries no marker and no list of them.
  if (!markFacts) {
    return [`# ${title}`, '', stripCheckMarkers(text).trim(), '', ...extrasOf(extras)].join('\n');
  }
  const markers = checkMarkers(text);
  const toCheck =
    markers.length === 0
      ? ['No fact is marked to be checked.']
      : markers.map((marker) => `- [ ] ${marker.what} (in: “${marker.near}”)`);
  return [
    `# ${title}`,
    '',
    text.trim(),
    '',
    '## Facts to check before recording',
    '',
    ...toCheck,
    '',
    ...extrasOf(extras),
  ].join('\n');
}

/** The shot list as a CSV file, with the times worked out at the speaking rate. */
export function exportShotList(text: string, wordsPerMinute: number | null): string {
  return shotListCsv(wordsPerMinute === null ? [] : parseCues(text, wordsPerMinute));
}

export interface VoiceoverCopy {
  /** Only what is spoken: no headings, no cues, no markers. */
  readonly text: string;
  /** How many facts are still marked to be checked. */
  readonly unchecked: number;
}

/** The clean voiceover text, with how many markers it would silently leave behind. */
export function voiceoverCopy(text: string, markFacts = true): VoiceoverCopy {
  return { text: cleanVoiceover(text), unchecked: markFacts ? checkMarkers(text).length : 0 };
}

/** What a voice was measured from, in one plain sentence. */
export function voiceNote(voice: VoiceView | null): string {
  if (voice === null) return 'No voice chosen yet.';
  const { profile } = voice;
  if (profile.videos === 0) {
    return `${voice.title}: its captions have not been read yet, so its pace is not known.`;
  }
  const pace =
    profile.wordsPerMinute === null ? 'pace unknown' : `${profile.wordsPerMinute} words a minute`;
  const sentences =
    profile.sentenceWords === null
      ? 'its captions carry no sentence ends, so sentence length and reading grade cannot be measured'
      : `sentences of about ${Math.round(profile.sentenceWords)} words, reading grade ${profile.grade === null ? 'unknown' : profile.grade.toFixed(1)}`;
  return `${voice.title}, from the captions of ${profile.videos} of its best videos: ${pace}; ${sentences}.`;
}

/** The most library hooks a script can model: the server refuses more. */
export const MAX_MODELS = MAX_HOOK_MODELS;

/**
 * The chosen models with one hook added, or taken away when it was there.
 * Past the most a script can model the list is handed back as it was.
 */
export function toggleModel(chosen: readonly string[], videoId: string): readonly string[] {
  if (chosen.includes(videoId)) return chosen.filter((id) => id !== videoId);
  return chosen.length >= MAX_MODELS ? chosen : [...chosen, videoId];
}

/** A channel the owner can write in the voice of. */
export interface VoiceChoice {
  readonly id: string;
  /** The name as the list shows it, saying which channel is the owner's or their model. */
  readonly label: string;
}

/** As much of a map as the voice list needs. */
interface MapVoices {
  readonly center: { readonly id: string; readonly title: string };
  readonly model: { readonly id: string; readonly title: string } | null;
  readonly channels: readonly {
    readonly id: string;
    readonly title: string;
    readonly peer: boolean;
    readonly removed: boolean;
  }[];
}

/**
 * The channels a script can be written in the voice of: the model channel
 * when the owner named one, their own, then the look-alikes on this map by
 * name. Only channels of this map: a voice is never borrowed from another.
 */
export function voiceChoices(map: MapVoices): readonly VoiceChoice[] {
  const lookalikes = map.channels
    .filter((channel) => channel.peer && !channel.removed)
    .map(({ id, title }) => ({ id, label: title }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const all = [
    ...(map.model ? [{ id: map.model.id, label: `Your model: ${map.model.title}` }] : []),
    { id: map.center.id, label: `Your channel: ${map.center.title}` },
    ...lookalikes,
  ];
  return all.filter((choice, index) => all.findIndex((other) => other.id === choice.id) === index);
}
