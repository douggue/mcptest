/**
 * "Write my Format Bible" on this engine's store: the facts are taken from
 * the format's filled slots in code, an AI writes the words from the same
 * read-only tools "Suggest a mix" uses, and code checks the answer before it
 * is kept. The export is the Markdown, the measured palette as JSON and a
 * PNG strip, a font list, and the slots' pictures read from this computer.
 */
import {
  bibleFacts,
  bibleFiles,
  bibleMarkdown,
  checkBible,
  liveSlots,
  mixPictures,
  zipFiles,
  type Format,
  type Ingredient,
  type ZipEntry,
} from '@jgtube/core';
import { readFile } from 'node:fs/promises';
import type { EngineId } from './engines/types';
import type { FormatBuilderDeps } from './formatBuilder';
import type { MixProgress } from './formatBuilderTypes';

export const EMPTY_SLOTS = 'Fill a few slots first: the Bible is written from what is in them.';
const NO_FORMAT = 'There is no such format.';

/** The format with only the slots whose ingredient is still on the shelf. */
const live = (format: Format, shelf: readonly Ingredient[]): Format => ({
  ...format,
  slots: liveSlots(format.slots, new Set(shelf.map((item) => item.id))),
});

/** Writes and keeps the Bible; rejects in plain words. Answers the format as kept. */
export async function writeBible(
  deps: FormatBuilderDeps,
  formatId: number,
  channel: string | null,
  only: EngineId | undefined,
  report: (progress: MixProgress) => void,
): Promise<Format> {
  const found = deps.formats.find(formatId);
  if (found === null) throw new Error(NO_FORMAT);
  const shelf = deps.shelf.list();
  const format = live(found, shelf);
  const facts = bibleFacts(format, shelf);
  if (facts.slots.length === 0) throw new Error(EMPTY_SLOTS);
  const filled = new Set(facts.slots.map((slot) => slot.ingredientId));
  const pictures = mixPictures(shelf.filter((item) => filled.has(item.id)));
  report({ step: 'asking', text: 'Asking the AI to write the Bible from your slots' });
  const answer = await deps.askMix(
    {
      formatId,
      formatName: format.name,
      channel,
      purpose: 'bible',
      pictures: pictures.local.flatMap((picture) => {
        const path = deps.picturePath(picture.ref);
        return path === null ? [] : [{ name: picture.name, path }];
      }),
      thumbnails: pictures.thumbnails.map((thumbnail) => thumbnail.videoId),
    },
    only,
  );
  report({ step: 'checking', text: 'Checking the Bible against what was measured' });
  const checked = checkBible(answer.text, facts, answer.engine, deps.now());
  if (!checked.ok) {
    throw new Error(`The AI answered, but ${checked.reason}. Nothing was kept. Try again.`);
  }
  deps.formats.saveBible(formatId, checked.bible);
  const saved = deps.formats.find(formatId);
  if (saved === null) throw new Error(NO_FORMAT);
  return saved;
}

/** The kept Bible as Markdown, with the format's name; null when there is none. */
export function bibleText(
  deps: FormatBuilderDeps,
  formatId: number,
): { readonly name: string; readonly text: string } | null {
  const format = deps.formats.find(formatId);
  if (format === null || format.bible === null) return null;
  return { name: format.name, text: bibleMarkdown(format.name, format.bible) };
}

/** The kept Bible as one zip; a picture no longer on this computer is left out. */
export async function bibleZip(
  deps: FormatBuilderDeps,
  formatId: number,
): Promise<Uint8Array | null> {
  const format = deps.formats.find(formatId);
  if (format === null || format.bible === null) return null;
  const images = await Promise.all(
    format.bible.facts.pictures.map(async (picture): Promise<ZipEntry[]> => {
      const path = deps.picturePath(picture.ref);
      if (path === null) return [];
      try {
        return [{ name: `images/${picture.name}`, bytes: new Uint8Array(await readFile(path)) }];
      } catch {
        return [];
      }
    }),
  );
  return zipFiles([...bibleFiles(format.name, format.bible), ...images.flat()]);
}
