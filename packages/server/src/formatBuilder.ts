/**
 * The format builder's formats on this engine's store: each read with its
 * checks worked out in code from the shelf, and "Suggest a mix", which puts
 * the shelf to an AI and keeps only what code finds on the shelf.
 */
import {
  checkMix,
  formatChecks,
  liveSlots,
  mixPictureNamed,
  mixPictures,
  shelfForMix,
  type Format,
  type FormatChange,
  type Ingredient,
  type IngredientRepo,
  type MixPictureRef,
  type SqliteFormatRepo,
  pathInside,
  teardownFolder,
} from '@jgtube/core';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { EngineAnswer } from './engines/fallback';
import type { EngineId } from './engines/types';
import type { FormatBuilderEngine, FormatView } from './formatBuilderTypes';
import type { MixAsk } from './formatMixRequests';

export type FormatStore = Pick<
  SqliteFormatRepo,
  'list' | 'find' | 'create' | 'update' | 'duplicate' | 'remove' | 'saveSuggestion'
>;

export interface FormatBuilderDeps {
  readonly formats: FormatStore;
  readonly shelf: Pick<IngredientRepo, 'list'>;
  readonly now: () => Date;
  channelTitle(channelId: string): string | null;
  /** Where a picture of the shelf is on this computer; null when it cannot be there. */
  picturePath(ref: MixPictureRef): string | null;
  askMix(ask: MixAsk, only?: EngineId): Promise<EngineAnswer<EngineId>>;
}

export const NO_FORMAT = 'There is no such format.';
export const EMPTY_SHELF =
  'Put a few ingredients on the shelf first: a suggestion mixes only what is there.';

function viewOf(deps: FormatBuilderDeps, format: Format, shelf: readonly Ingredient[]): FormatView {
  const slots = liveSlots(format.slots, new Set(shelf.map((item) => item.id)));
  const checks = formatChecks({ slots, targetSeconds: format.targetSeconds }, shelf);
  const top = checks.originality.channelId;
  return {
    ...format,
    slots,
    checks,
    // A channel not in the store is "one channel" on the page, never a bare id.
    topChannelTitle: top === null ? null : deps.channelTitle(top),
  };
}

function pictureAsk(deps: FormatBuilderDeps, shelf: readonly Ingredient[]) {
  const pictures = mixPictures(shelf);
  return {
    pictures: pictures.local.flatMap((picture) => {
      const path = deps.picturePath(picture.ref);
      return path === null ? [] : [{ name: picture.name, path }];
    }),
    thumbnails: pictures.thumbnails.map((thumbnail) => thumbnail.videoId),
  };
}

/** Where a shelf picture is under the downloads folder; null when there is none or the name is not safe. */
export function mixPicturePath(root: () => string): (ref: MixPictureRef) => string | null {
  return (ref) => {
    try {
      return ref.kind === 'teardown'
        ? pathInside(teardownFolder(root(), ref.videoId), ref.file)
        : pathInside(join(root(), 'formats'), ref.file);
    } catch {
      return null;
    }
  };
}

export function formatBuilder(deps: FormatBuilderDeps): FormatBuilderEngine {
  const { formats, now } = deps;
  const shelf = (): readonly Ingredient[] => deps.shelf.list();
  const view = (format: Format | null): FormatView | null =>
    format === null ? null : viewOf(deps, format, shelf());
  return {
    listFormats(channel = null) {
      const items = shelf();
      return formats.list(channel).map((format) => viewOf(deps, format, items));
    },
    createFormat: (name, targetSeconds, channel = null) =>
      viewOf(deps, formats.create(name, targetSeconds, now(), channel), shelf()),
    updateFormat: (id, change: FormatChange) => view(formats.update(id, change, now())),
    duplicateFormat: (id) => view(formats.duplicate(id, now())),
    removeFormat: (id) => formats.remove(id),
    formatName: (id) => formats.find(id)?.name ?? null,

    async suggestMix(formatId, channel, only, report) {
      const format = formats.find(formatId);
      if (format === null) throw new Error(NO_FORMAT);
      const items = shelf();
      if (items.length === 0) throw new Error(EMPTY_SHELF);
      report({ step: 'asking', text: 'Asking the AI for a mix from your shelf' });
      const answer = await deps.askMix(
        { formatId, formatName: format.name, channel, ...pictureAsk(deps, items) },
        only,
      );
      report({ step: 'checking', text: 'Checking each slot against your shelf' });
      const checked = checkMix(answer.text, items, answer.engine, now());
      if (!checked.ok) {
        throw new Error(`The AI answered, but ${checked.reason}. Nothing was changed. Try again.`);
      }
      formats.saveSuggestion(formatId, checked.suggestion);
      const saved = view(formats.find(formatId));
      if (saved === null) throw new Error(NO_FORMAT);
      return saved;
    },

    shelfForMix(formatId) {
      const format = formats.find(formatId);
      return format === null ? null : shelfForMix(format, shelf());
    },

    async mixPicture(name) {
      const picture = mixPictureNamed(mixPictures(shelf()), name);
      const path = picture === null ? null : deps.picturePath(picture.ref);
      if (path === null) return null;
      try {
        return new Uint8Array(await readFile(path));
      } catch {
        return null;
      }
    },
  };
}
