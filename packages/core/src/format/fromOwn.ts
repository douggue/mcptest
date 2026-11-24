/**
 * Ingredients the owner adds by hand: a note, a picture or a clip of their
 * own. Nothing about them is counted, so their evidence is empty.
 */
import { noEvidence } from './evidence';
import { shortName } from './fromLab';
import type { IngredientDraft, IngredientLayer } from './types';

/** The most characters of a note kept on the shelf. */
export const MAX_NOTE_TEXT = 4_000;

/** A file saved under the format builder's folder: a key and a known extension. */
export const IMAGE_FILE = /^[\w-]{11}\.(?:png|jpg|webp)$/;
/** An uploaded clip, by the key the One video upload gave it. */
export const CLIP_KEY = /^[\w-]{11}$/;

interface OwnInput {
  readonly layer: IngredientLayer;
  readonly name: string;
}

const own = (
  input: OwnInput,
  source: 'note' | 'image' | 'clip',
  sourceKey: string,
  sourceLabel: string,
): Omit<IngredientDraft, 'details' | 'media'> => ({
  layer: input.layer,
  name: shortName(input.name),
  source,
  sourceKey,
  sourceLabel,
  centerChannelId: null,
  channelIds: [],
  evidence: noEvidence(),
});

export function ingredientFromNote(
  input: OwnInput & { readonly text: string },
  key: string,
): IngredientDraft {
  return {
    ...own(input, 'note', key, 'Your note'),
    details: { text: input.text.trim().slice(0, MAX_NOTE_TEXT) },
    media: [],
  };
}

export function ingredientFromImage(input: OwnInput & { readonly file: string }): IngredientDraft {
  if (!IMAGE_FILE.test(input.file)) throw new Error('Not a picture saved by Jgtube');
  return {
    ...own(input, 'image', input.file, 'Your picture'),
    details: { file: input.file },
    media: [{ kind: 'image', file: input.file }],
  };
}

export function ingredientFromClip(input: OwnInput & { readonly file: string }): IngredientDraft {
  if (!CLIP_KEY.test(input.file)) throw new Error('Not a clip saved by Jgtube');
  return {
    ...own(input, 'clip', input.file, 'Your clip'),
    details: { file: input.file },
    media: [],
  };
}
