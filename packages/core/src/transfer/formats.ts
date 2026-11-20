import type { Idea, TitledVideo } from './ideas';
import { placeResults } from './results';
import { SUBJECT_SLOT, isSlot } from './template';
import type { FormatSubject, TransferFormat } from './types';

/**
 * "Same format": titles that are the same words around a subject that changes
 * ("{place}'s New Invention Could Make {subject} Obsolete Forever" for TVs,
 * for solar panels, for carbon fibre). A format moving to a new subject is how
 * an idea crosses from one category to another.
 *
 * Each title is filed under every way of blanking one short run of its words.
 * Titles that land under the same blanked form share everything but that run,
 * so no title is compared with another and the work grows with the number of
 * titles, not with its square.
 */

/**
 * The subject is at most this many words: a noun or a two-word noun phrase
 * ("solar panels"). Blanking longer runs makes unrelated titles of the same
 * length look alike.
 */
export const FORMAT_MAX_SUBJECT_WORDS = 2;
/** The words around the subject must be a phrase in their own right: three, as for an idea. */
export const FORMAT_MIN_FIXED_WORDS = 3;
/**
 * Two subjects can be one channel trying a title twice. A third shows the
 * wording is being reused as a frame for whatever subject comes next.
 */
export const FORMAT_MIN_SUBJECTS = 3;
/** A format is only worth learning from once more than one channel uses it. */
export const FORMAT_MIN_CHANNELS = 2;
/** Subjects listed per format: enough to see the range, few enough to scan. */
export const FORMAT_SUBJECTS_SHOWN = 8;

/** One idea filed under one way of blanking its subject. */
export interface SubjectEntry {
  readonly idea: Idea;
  /** The words that were blanked, joined by a space. */
  readonly subject: string;
  readonly subjectWords: number;
}

export type SubjectIndex = ReadonlyMap<string, readonly SubjectEntry[]>;

interface Blanked {
  readonly key: string;
  readonly subject: string;
  readonly subjectWords: number;
}

/** The words before each position joined, and the words from each position on: joined once, not per blanking. */
function joinedEnds(words: readonly string[]): {
  readonly before: readonly string[];
  readonly after: readonly string[];
} {
  const before = words.map((_, index) => words.slice(0, index).join(' '));
  const after = words.map((_, index) => words.slice(index).join(' '));
  return { before, after: [...after, ''] };
}

/** Every way of blanking a run of one or two words that leaves a phrase around it. */
function blankings(words: readonly string[]): readonly Blanked[] {
  const fixedBudget = words.filter((word) => !isSlot(word)).length - FORMAT_MIN_FIXED_WORDS;
  const longest = Math.min(FORMAT_MAX_SUBJECT_WORDS, fixedBudget);
  if (longest < 1) return [];
  const { before, after } = joinedEnds(words);
  const found: Blanked[] = [];
  for (let length = 1; length <= longest; length += 1) {
    for (let start = 0; start + length <= words.length; start += 1) {
      const run = words.slice(start, start + length);
      if (run.some(isSlot)) continue;
      const head = before[start] ?? '';
      const tail = after[start + length] ?? '';
      const key = `${head}${head ? ' ' : ''}${SUBJECT_SLOT}${tail ? ' ' : ''}${tail}`;
      found.push({ key, subject: run.join(' '), subjectWords: length });
    }
  }
  return found;
}

/** Every idea filed under each blanked form of its words. */
export function indexBySubject(ideas: readonly Idea[]): SubjectIndex {
  // Filled in place: copying a list for each idea added would cost its square.
  const index = new Map<string, SubjectEntry[]>();
  for (const idea of ideas) {
    for (const { key, subject, subjectWords } of blankings(idea.words)) {
      const entries = index.get(key) ?? [];
      if (entries.length === 0) index.set(key, entries);
      entries.push({ idea, subject, subjectWords });
    }
  }
  return index;
}

const videosOf = (entries: readonly SubjectEntry[]): readonly TitledVideo[] =>
  entries.flatMap((entry) => entry.idea.videos);
const channelCount = (videos: readonly TitledVideo[]): number =>
  new Set(videos.map((entry) => entry.video.channelId)).size;
const subjectCount = (entries: readonly SubjectEntry[]): number =>
  new Set(entries.map((entry) => entry.subject)).size;

function isFormat(entries: readonly SubjectEntry[]): boolean {
  return (
    subjectCount(entries) >= FORMAT_MIN_SUBJECTS &&
    channelCount(videosOf(entries)) >= FORMAT_MIN_CHANNELS
  );
}

interface Choice {
  readonly key: string;
  readonly entry: SubjectEntry;
  readonly subjects: number;
}

/** Whether a blanked form is the better home for an idea: more subjects, then the longer form. */
function isBetter(candidate: Choice, current: Choice | undefined): boolean {
  if (!current) return true;
  if (candidate.subjects !== current.subjects) return candidate.subjects > current.subjects;
  if (candidate.key.length !== current.key.length) return candidate.key.length > current.key.length;
  return candidate.key < current.key;
}

/** Each idea's one format: of the forms it could go under, the one with the most subjects. */
function chooseFormats(index: SubjectIndex): ReadonlyMap<string, readonly SubjectEntry[]> {
  const chosen = new Map<string, Choice>();
  for (const [key, entries] of index) {
    if (!isFormat(entries)) continue;
    const subjects = subjectCount(entries);
    for (const entry of entries) {
      const candidate = { key, entry, subjects };
      if (isBetter(candidate, chosen.get(entry.idea.key))) chosen.set(entry.idea.key, candidate);
    }
  }
  const formats = new Map<string, SubjectEntry[]>();
  for (const { key, entry } of chosen.values()) {
    const entries = formats.get(key) ?? [];
    if (entries.length === 0) formats.set(key, entries);
    entries.push(entry);
  }
  return formats;
}

const byViews = (a: TitledVideo, b: TitledVideo): number =>
  b.video.views - a.video.views || (a.video.id < b.video.id ? -1 : 1);

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle] ?? 0;
  return sorted.length % 2 === 1 ? upper : ((sorted[middle - 1] ?? 0) + upper) / 2;
}

/** The subjects a format was used for, most viewed first. */
function subjectsOf(entries: readonly SubjectEntry[]): readonly FormatSubject[] {
  const subjects = [...new Set(entries.map((entry) => entry.subject))];
  return subjects
    .map((subject): FormatSubject => {
      const videos = [...videosOf(entries.filter((entry) => entry.subject === subject))].sort(
        byViews,
      );
      const top = videos[0]?.video;
      return {
        subject,
        videos: videos.length,
        channels: channelCount(videos),
        bestViews: top?.views ?? 0,
        videoId: top?.id ?? '',
        title: top?.title ?? '',
        channelTitle: top?.channelTitle ?? '',
      };
    })
    .sort((a, b) => b.bestViews - a.bestViews || (a.subject < b.subject ? -1 : 1));
}

const WORD_EDGE = '[\\p{L}\\p{N}]';

/** A title's template text with its subject blanked, small words and all. */
function shownTemplate(text: string, subject: string): string {
  const words = subject.split(' ');
  const whole = (word: string): string => `(?<!${WORD_EDGE})${word}(?!${WORD_EDGE})`;
  const first = whole(words[0] ?? '');
  const pattern = words.length === 1 ? first : `${first}[\\s\\S]*?${whole(words.at(-1) ?? '')}`;
  return text.replace(new RegExp(pattern, 'u'), SUBJECT_SLOT);
}

function describeFormat(key: string, entries: readonly SubjectEntry[]): TransferFormat {
  const videos = [...videosOf(entries)].sort(byViews);
  const top = videos[0];
  const topSubject = top ? entries.find((entry) => entry.idea.videos.includes(top)) : undefined;
  const subjects = subjectsOf(entries);
  return {
    key,
    template: top && topSubject ? shownTemplate(top.template.text, topSubject.subject) : key,
    subjectCount: subjects.length,
    channelCount: channelCount(videos),
    videoCount: videos.length,
    bestViews: top?.video.views ?? 0,
    medianViews: median(videos.map((entry) => entry.video.views)),
    places: placeResults(
      videos.flatMap((entry) => {
        const place = entry.template.places[0];
        return place ? [{ place, views: entry.video.views }] : [];
      }),
    ),
    subjects: subjects.slice(0, FORMAT_SUBJECTS_SHOWN),
  };
}

/**
 * The title formats used for at least three subjects by at least two channels,
 * the one with the most subjects first. Each idea counts in one format only.
 */
export function groupFormats(index: SubjectIndex): readonly TransferFormat[] {
  return [...chooseFormats(index)]
    .filter(([, entries]) => isFormat(entries))
    .map(([key, entries]) => describeFormat(key, entries))
    .sort(
      (a, b) =>
        b.subjectCount - a.subjectCount || b.bestViews - a.bestViews || (a.key < b.key ? -1 : 1),
    );
}

export interface OneWordVariant extends TitledVideo {
  /** The word the variant has where the idea has another. */
  readonly word: string;
}

/**
 * The videos whose title is one word away from an idea's, most viewed first.
 * These are what a reader must judge: the word may be a synonym (the same
 * idea) or a new subject (another idea in the same format).
 */
export function oneWordVariants(index: SubjectIndex, ideaKey: string): readonly OneWordVariant[] {
  const found = new Map<string, OneWordVariant>();
  for (const { key, subjectWords } of blankings(ideaKey.split(' '))) {
    if (subjectWords !== 1) continue;
    for (const entry of index.get(key) ?? []) {
      if (entry.subjectWords !== 1 || entry.idea.key === ideaKey) continue;
      for (const titled of entry.idea.videos) {
        found.set(titled.video.id, { ...titled, word: entry.subject });
      }
    }
  }
  return [...found.values()].sort(
    (a, b) => b.video.views - a.video.views || (a.video.id < b.video.id ? -1 : 1),
  );
}
