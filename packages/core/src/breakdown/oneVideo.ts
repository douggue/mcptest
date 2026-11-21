import { randomBytes } from 'node:crypto';
import { splitMarked } from './parts';

/**
 * A deep breakdown of one video, from a YouTube link or a file the owner
 * gives: the ready prompts its answer holds, and how a given file is named
 * and told apart.
 */

/** The three ready prompts an answer holds, each between its own two marker lines. */
export const ONE_VIDEO_PROMPTS = {
  script: 'SCRIPT PROMPT',
  visual: 'VISUAL PROMPT',
  thumbnail: 'THUMBNAIL PROMPT',
} as const;
export type OneVideoPromptId = keyof typeof ONE_VIDEO_PROMPTS;
export const ONE_VIDEO_PROMPT_IDS = Object.keys(ONE_VIDEO_PROMPTS) as readonly OneVideoPromptId[];

/** The four sections the answer is written in, in order. */
export const ONE_VIDEO_SECTIONS = [
  'WHAT IT IS',
  'HOW IT IS MADE',
  'HOW TO REPLICATE IT WITH AI',
  'WHAT TO AVOID COPYING',
] as const;

export interface LiftedPrompts {
  /** The answer without the prompts and their marker lines. */
  readonly body: string;
  /** Each prompt as written; null when the answer did not hold it exactly once. */
  readonly prompts: Readonly<Record<OneVideoPromptId, string | null>>;
}

/** Lifts the ready prompts out of an answer; a prompt is never guessed at. */
export function liftOneVideoPrompts(text: string): LiftedPrompts {
  return ONE_VIDEO_PROMPT_IDS.reduce<LiftedPrompts>(
    (lifted, id) => {
      const split = splitMarked(lifted.body, ONE_VIDEO_PROMPTS[id]);
      return { body: split.rest, prompts: { ...lifted.prompts, [id]: split.marked } };
    },
    { body: text, prompts: { script: null, visual: null, thumbnail: null } },
  );
}

/** The kinds of video file taken from the owner: what the browser says it is, and how it is saved. */
export const UPLOAD_KINDS = [
  { type: 'video/mp4', extension: '.mp4' },
  { type: 'video/webm', extension: '.webm' },
  { type: 'video/quicktime', extension: '.mov' },
] as const;
export type UploadKind = (typeof UPLOAD_KINDS)[number];

/** The kind of file a content type names, or null for one that is not taken. */
export function uploadKindOf(contentType: string): UploadKind | null {
  const type = (contentType.split(';')[0] ?? '').trim().toLowerCase();
  return UPLOAD_KINDS.find((kind) => kind.type === type) ?? null;
}

const KEY_BYTES = 8;
const KEY_LENGTH = 11;

/**
 * A new id for a file the owner gives, of the same shape as a YouTube video
 * id, so that the frames cut from it and what an engine writes about it are
 * kept and found exactly as a YouTube video's are. Made at random, so it
 * names no real video in practice.
 */
export function newUploadKey(random: (size: number) => Buffer = randomBytes): string {
  return random(KEY_BYTES).toString('base64url').slice(0, KEY_LENGTH);
}
