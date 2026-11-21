/**
 * A stored breakdown, read back: the view the page shows, the four texts the
 * owner can download, and the files saved on disk. Everything here reads the
 * store; nothing starts an engine.
 */
import {
  BREAKDOWN_PARTS,
  BREAKDOWN_PART_TITLES,
  PROMPT_MARKERS,
  breakdownFolder,
  breakdownTexts,
  saveBreakdownTexts,
  splitMarked,
  type BreakdownFileId,
  type BreakdownPartId,
  type BreakdownRepo,
  type BreakdownSaved,
  type BreakdownTextFile,
  type StoredBreakdownPart,
} from '@jgtube/core';
import type { BreakdownPartView, BreakdownView } from './breakdownTypes';

interface Channel {
  readonly id: string;
  readonly title: string;
}

/** One part as the page shows it: its text without the marked prompt, and the prompt on its own. */
function partView(id: BreakdownPartId, stored: StoredBreakdownPart | undefined): BreakdownPartView {
  const head = { id, title: BREAKDOWN_PART_TITLES[id] };
  const none = { body: '', prompt: null, engine: null };
  if (stored === undefined) {
    return { ...head, ...none, state: 'missing', writtenAt: null, reason: null };
  }
  const writtenAt = stored.writtenAt.toISOString();
  if (!stored.written) {
    return { ...head, ...none, state: 'failed', writtenAt, reason: stored.reason };
  }
  const marker =
    id === 'thumbnails' || id === 'master' || id === 'picture' ? PROMPT_MARKERS[id] : undefined;
  const { marked, rest } =
    marker === undefined ? { marked: null, rest: stored.text } : splitMarked(stored.text, marker);
  return {
    ...head,
    state: 'written',
    body: rest,
    prompt: marked,
    engine: stored.engine,
    writtenAt,
    reason: null,
  };
}

/**
 * A channel's stored parts as one view: every part in the order it is read,
 * each written, failed or missing; which of the four texts there is to
 * download; and the folder the texts were saved in, when they are on disk.
 */
export function breakdownView(
  channel: Channel,
  parts: readonly StoredBreakdownPart[],
  folder: string | null,
): BreakdownView {
  const written = parts.filter((part) => part.written);
  const newest = Math.max(...written.map((part) => part.writtenAt.getTime()));
  return {
    channel: { id: channel.id, title: channel.title },
    writtenAt: written.length === 0 ? null : new Date(newest).toISOString(),
    parts: BREAKDOWN_PARTS.map((id) =>
      partView(
        id,
        parts.find((part) => part.part === id),
      ),
    ),
    files: breakdownTexts(channel, parts).map((file) => ({
      id: file.id,
      name: file.name,
      available: file.text !== null,
      reason: file.reason,
    })),
    folder,
  };
}

export interface BreakdownStoreDeps {
  readonly parts: BreakdownRepo;
  readonly now: () => Date;
  /** The downloads folder. Throws when the store is only in memory and no folder is named. */
  readonly root: () => string;
}

/** What is read back from, and saved of, the stored breakdowns. */
export interface BreakdownStore {
  /** The channel's breakdown as the page shows it; null when no part of it was ever stored. */
  view(channel: Channel): Promise<BreakdownView | null>;
  /** One of the four texts, put together from the stored parts. */
  text(channel: Channel, file: BreakdownFileId): BreakdownTextFile;
  /** Writes the four texts to the channel's folder. Rejects when there is nowhere to save. */
  save(channel: Channel): Promise<BreakdownSaved>;
}

export function breakdownStore(deps: BreakdownStoreDeps): BreakdownStore {
  /** The folder the channel's texts are in; null when there is none, or nowhere to look. */
  const folderOf = async (channel: Channel): Promise<string | null> => {
    try {
      return await breakdownFolder(deps.root(), channel);
    } catch {
      return null;
    }
  };
  return {
    async view(channel) {
      const parts = deps.parts.list(channel.id);
      return parts.length === 0 ? null : breakdownView(channel, parts, await folderOf(channel));
    },

    text(channel, file) {
      const texts = breakdownTexts(channel, deps.parts.list(channel.id));
      const found = texts.find((text) => text.id === file);
      if (found === undefined) throw new Error('There is no such text in a breakdown');
      return found;
    },

    async save(channel) {
      return saveBreakdownTexts(
        deps.root(),
        channel,
        breakdownTexts(channel, deps.parts.list(channel.id)),
        deps.now(),
      );
    },
  };
}
