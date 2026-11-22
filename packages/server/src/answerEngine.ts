/**
 * What becomes of a quick analysis's answer once an engine has given it: it
 * is kept for the channel, the ready prompt in it (a thumbnail review ends
 * with one) is lifted out from between its marker lines, and the videos it
 * names are looked up, so the page can show their real thumbnails. An id that
 * is not a stored video of the channel's map is dropped here and never shown.
 */
import {
  THUMBNAIL_PROMPT_MARKER,
  parseChannelRef,
  splitMarked,
  videoRefIds,
  videosNamed,
  type ChannelNoteKind,
  type ChannelNoteRepo,
  type ChannelRepo,
  type MapVideoDeps,
  type NamedVideo,
  type StoredChannelNote,
} from '@jgtube/core';
import type { QuickAnalysisId } from './analyses';
import { ownAnswerOf, ownNoteText } from './ownQuestion';

/** The note an own question and its answer are kept as. */
const OWN_KIND: ChannelNoteKind = 'own-question';

/** The most ids one lookup takes: an answer names a few dozen videos at most. */
export const MAX_NAMED_VIDEOS = 80;

/** What each quick analysis's answer is kept as. */
export const ANSWER_KINDS: Readonly<Record<QuickAnalysisId, ChannelNoteKind>> = {
  thumbnails: 'thumbnail-review',
  topics: 'video-ideas',
  'near-misses': 'near-misses',
};

/** A kept answer as the page shows it. */
export interface AnswerView {
  readonly analysis: QuickAnalysisId;
  readonly channelId: string;
  /** The answer without the ready prompt and its marker lines. */
  readonly text: string;
  /** The ready prompt lifted out of the answer; null when it holds none, or none that can be told for certain. */
  readonly prompt: string | null;
  /** The stored videos of this channel's map that the answer names, in the order named. */
  readonly videos: readonly NamedVideo[];
  /** The engine that wrote it, by its id. */
  readonly engine: string;
  /** When it was written, as an ISO-8601 string. */
  readonly writtenAt: string;
}

export interface AnswerEngine {
  /** Keeps an answer for a channel and returns it as the page shows it; null when the channel is not stored. */
  keepAnswer(
    analysis: QuickAnalysisId,
    channel: string,
    answer: { readonly text: string; readonly engine: string },
  ): AnswerView | null;
  /** The answer kept for a channel; null when there is none. Reads the store only. */
  findAnswer(analysis: QuickAnalysisId, channel: string): AnswerView | null;
  /**
   * The stored videos of a channel's map among these ids, and of `alsoOf`
   * when it names a stored channel; none for a channel that is not stored.
   */
  namedVideos(channel: string, videoIds: readonly string[], alsoOf?: string): readonly NamedVideo[];
  /** What an engine wrote for a channel, by kind, for a tool to hand over; null when there is none. */
  findChannelNote(channel: string, kind: ChannelNoteKind): StoredChannelNote | null;
  /** Keeps the owner's own question and its answer for a channel; null when the channel is not stored. */
  keepOwnAnswer(
    channel: string,
    question: string,
    answer: { readonly text: string; readonly engine: string },
  ): OwnAnswerView | null;
  /** The owner's last own question for a channel and its answer; null when there is none. */
  findOwnAnswer(channel: string): OwnAnswerView | null;
}

/** The owner's own question, as kept with its answer. */
export interface OwnAnswerView {
  readonly channelId: string;
  /** The question as the owner typed it; null for an answer kept without one. */
  readonly question: string | null;
  readonly text: string;
  readonly engine: string;
  readonly writtenAt: string;
}

const ownViewOf = (note: StoredChannelNote): OwnAnswerView => ({
  channelId: note.channelId,
  ...ownAnswerOf(note.text),
  engine: note.engine,
  writtenAt: note.writtenAt.toISOString(),
});

export interface AnswerDeps {
  readonly repos: MapVideoDeps & {
    readonly channels: Pick<ChannelRepo, 'findById' | 'findByHandle'>;
    readonly notes: ChannelNoteRepo;
  };
  readonly now: () => Date;
}

/** Only a thumbnail review is asked to end with a ready prompt. */
const promptOf = (analysis: QuickAnalysisId, text: string) =>
  analysis === 'thumbnails'
    ? splitMarked(text, THUMBNAIL_PROMPT_MARKER)
    : { marked: null, rest: text };

export function answerEngine({ repos, now }: AnswerDeps): AnswerEngine {
  const storedId = (channel: string): string | null => {
    try {
      const ref = parseChannelRef(channel);
      const stored =
        ref.kind === 'id'
          ? repos.channels.findById(ref.id)
          : repos.channels.findByHandle(ref.handle);
      return stored?.id ?? null;
    } catch {
      return null;
    }
  };
  const viewOf = (analysis: QuickAnalysisId, note: StoredChannelNote): AnswerView => {
    const { marked, rest } = promptOf(analysis, note.text);
    return {
      analysis,
      channelId: note.channelId,
      text: rest,
      prompt: marked,
      // Only what is named outside the prompt: a prompt is pasted elsewhere and names no video.
      videos: videosNamed(repos, note.channelId, videoRefIds(rest).slice(0, MAX_NAMED_VIDEOS)),
      engine: note.engine,
      writtenAt: note.writtenAt.toISOString(),
    };
  };
  return {
    keepAnswer(analysis, channel, answer) {
      const channelId = storedId(channel);
      if (channelId === null) return null;
      const kind = ANSWER_KINDS[analysis];
      repos.notes.save({ channelId, kind, engine: answer.engine, text: answer.text }, now());
      const kept = repos.notes.find(channelId, kind);
      return kept ? viewOf(analysis, kept) : null;
    },

    findAnswer(analysis, channel) {
      const channelId = storedId(channel);
      const note = channelId ? repos.notes.find(channelId, ANSWER_KINDS[analysis]) : null;
      return note ? viewOf(analysis, note) : null;
    },

    namedVideos(channel, videoIds, alsoOf) {
      const channelId = storedId(channel);
      if (channelId === null) return [];
      const other = alsoOf === undefined ? null : storedId(alsoOf);
      return videosNamed(repos, channelId, videoIds.slice(0, MAX_NAMED_VIDEOS), other);
    },

    findChannelNote(channel, kind) {
      const channelId = storedId(channel);
      return channelId ? repos.notes.find(channelId, kind) : null;
    },

    keepOwnAnswer(channel, question, answer) {
      const channelId = storedId(channel);
      if (channelId === null) return null;
      const text = ownNoteText(question, answer.text);
      repos.notes.save({ channelId, kind: OWN_KIND, engine: answer.engine, text }, now());
      const kept = repos.notes.find(channelId, OWN_KIND);
      return kept ? ownViewOf(kept) : null;
    },

    findOwnAnswer(channel) {
      const channelId = storedId(channel);
      const note = channelId ? repos.notes.find(channelId, OWN_KIND) : null;
      return note ? ownViewOf(note) : null;
    },
  };
}
