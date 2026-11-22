/**
 * Pictures handed to an engine as files in its own run folder, named in the
 * question with `@`. Antigravity's CLI passes on only the text of a tool's
 * results, so this is how it is shown pictures (see "How picture questions
 * reach Antigravity" in the system design); Claude Code and Codex keep the
 * picture tools.
 *
 * Every picture question uses this one helper: the listing by role, the line
 * asking which files were opened, and the check that the answer names at
 * least one of them. File names are made in code; nothing from outside
 * reaches a name or the listing.
 */
import { readFile } from 'node:fs/promises';
import type { RunFile } from './engines/types';

/** Pictures as files, and how the question lists them. */
export interface PictureFileSet {
  readonly files: readonly RunFile[];
  /** The files by role, each as `@name`; "none" when there are none. */
  readonly listing: string;
}

/** What a files-route question needs, chosen in code from what the question is about. */
export type PictureNeed =
  | { readonly kind: 'board' }
  | { readonly kind: 'thumbnails'; readonly groups: readonly ThumbnailGroup[] }
  | { readonly kind: 'teardown'; readonly videoIds: readonly string[] }
  | { readonly kind: 'frames'; readonly videoId: string };

export interface ThumbnailGroup {
  readonly label: string;
  readonly videoIds: readonly string[];
}

/** The line an answer opens with, naming the picture files it opened. */
export const OPENED_LINE = 'PICTURES OPENED';
const NONE = 'none';

export interface FileGroup {
  readonly label: string;
  readonly files: readonly RunFile[];
}

/** Groups of files as one set, listed by label; empty groups are left out. */
export function groupedFiles(groups: readonly FileGroup[]): PictureFileSet {
  const shown = groups.filter((group) => group.files.length > 0);
  return {
    files: shown.flatMap((group) => group.files),
    listing:
      shown.length === 0
        ? NONE
        : shown
            .map((group) => `${group.label}: ${group.files.map((f) => `@${f.name}`).join(' ')}`)
            .join('; '),
  };
}

/** The rule that has a text answer say which files it opened, so code can check it. */
export const openedRule = (): string =>
  `Start your answer with one line of its own: ${OPENED_LINE}: how many picture files you opened, then their file names, separated by commas. Name only files you opened and looked at; if you could open none, say so on that line.`;

/** How a question asks an engine to look at pictures handed to it as files. */
export const filesLook = (files: PictureFileSet): string =>
  `The pictures are files in your folder. Open each one with your own file-reading tool and look at it: ${files.listing}. ${openedRule()}`;

export interface PicturesSeen {
  /** How many picture files the engine was given. */
  readonly shown: number;
  /** How many of them its answer names. */
  readonly named: number;
}

/** How many of the files it was given an answer names, by file name, with or without the `@`. */
export function picturesSeen(answer: string, files: PictureFileSet): PicturesSeen {
  const text = answer.toLowerCase();
  const named = files.files.filter((file) => text.includes(file.name.toLowerCase())).length;
  return { shown: files.files.length, named };
}

/** Whether an answer shows no sign of the pictures it was handed: given some, it names none. */
export const sawNoPictures = (seen: PicturesSeen): boolean => seen.shown > 0 && seen.named === 0;

export interface PathPicture {
  /** The name in the run folder, made in code. */
  readonly name: string;
  readonly path: string;
}

/** Pictures on this computer read into files; one that cannot be read is left out. */
export async function filesFromPaths(
  groups: readonly { readonly label: string; readonly pictures: readonly PathPicture[] }[],
): Promise<PictureFileSet> {
  const read = await Promise.all(
    groups.map(async (group) => ({
      label: group.label,
      files: (
        await Promise.all(
          group.pictures.map(async (picture): Promise<RunFile[]> => {
            try {
              return [{ name: picture.name, bytes: new Uint8Array(await readFile(picture.path)) }];
            } catch {
              return [];
            }
          }),
        )
      ).flat(),
    })),
  );
  return groupedFiles(read);
}
