import { PROMPT_MARKERS, splitMarked } from '../breakdown/parts';
import { stripVideoRefs, videoRefIds } from '../video/refs';

/**
 * Reading an engine's answer to "write a thumbnail prompt for this concept":
 * the prompt, lifted out from between its two marker lines as it stands, the
 * videos whose thumbnails it says it learned from, and its reason in a
 * sentence. A prompt is found only between the marker lines; it is never
 * guessed at.
 */

/** The name the prompt is marked by: the same lines a thumbnail review and a breakdown use. */
export const THUMBNAIL_PROMPT_MARKER = PROMPT_MARKERS.thumbnails;
/** A detailed prompt runs to a few hundred words; past this it is not one prompt. */
export const MAX_THUMBNAIL_PROMPT_CHARS = 6000;
const MAX_WHY_CHARS = 600;
const WHY_LINE = /^WHY:\s*(.*)$/m;

export interface ParsedThumbnailPrompt {
  /** The prompt as written, ready to paste. */
  readonly prompt: string;
  /** Why this style, in the engine's words; empty when it gave none. */
  readonly why: string;
  /** The ids it names outside the prompt as the thumbnails it learned from. Not yet checked against the store. */
  readonly learnedFrom: readonly string[];
}

export type ThumbnailPromptAnswer = ParsedThumbnailPrompt | { readonly problem: string };

export function parseThumbnailPrompt(text: string): ThumbnailPromptAnswer {
  const { marked, rest } = splitMarked(text, THUMBNAIL_PROMPT_MARKER);
  if (marked === null) {
    return { problem: 'the answer did not hold one prompt between the two marker lines' };
  }
  if (marked.length > MAX_THUMBNAIL_PROMPT_CHARS) {
    return { problem: 'the prompt is longer than a thumbnail prompt can be' };
  }
  return {
    prompt: marked,
    why: stripVideoRefs(WHY_LINE.exec(rest)?.[1] ?? '')
      .trim()
      .slice(0, MAX_WHY_CHARS),
    learnedFrom: videoRefIds(rest),
  };
}
