import type { LibraryHook } from '@jgtube/core';
import type { Answered } from './ideaLab';

export type { LibraryHook };

/**
 * The hook library as the page reads it: the first minute of what the top
 * breakout videos on this map say, with the name an AI gave to the way each
 * opens. Searching and filtering happen here, on what the server sent.
 */

export interface HookLibrary {
  readonly centerChannelId: string;
  /** How much of each opening is taken, in seconds. */
  readonly seconds: number;
  /** The most videos a library is built from. */
  readonly cap: number;
  readonly hooks: readonly LibraryHook[];
}

export interface HookBuildOutcome {
  readonly kind: 'hooks-built';
  readonly library: HookLibrary;
  readonly read: number;
  readonly failed: readonly { readonly videoId: string; readonly reason: string }[];
}

export interface HookLabelOutcome extends Answered {
  readonly kind: 'hooks-labelled';
  readonly library: HookLibrary;
  readonly labelled: number;
  readonly unread: number;
}

/** How much of a hook a card shows before "show all": about four lines. */
export const HOOK_PREVIEW_CHARS = 320;

export interface StyleCount {
  readonly style: string;
  readonly count: number;
}

/**
 * The style names in use, most used first: the filters are built from the
 * names that came back, never from a list made in advance.
 */
export function hookStyles(hooks: readonly LibraryHook[]): readonly StyleCount[] {
  const counts = hooks.reduce<ReadonlyMap<string, number>>(
    (seen, hook) =>
      hook.style === null
        ? seen
        : new Map([...seen, [hook.style, (seen.get(hook.style) ?? 0) + 1]]),
    new Map(),
  );
  return [...counts]
    .map(([style, count]) => ({ style, count }))
    .sort((a, b) => b.count - a.count || a.style.localeCompare(b.style));
}

/** The hooks whose words or title hold what was typed, and that have the chosen style when one is chosen. */
export function filterHooks(
  hooks: readonly LibraryHook[],
  query: string,
  style: string | null,
): readonly LibraryHook[] {
  const wanted = query.trim().toLowerCase();
  return hooks.filter((hook) => {
    if (style !== null && hook.style !== style) return false;
    if (wanted === '') return true;
    return `${hook.text ?? ''}\n${hook.title}`.toLowerCase().includes(wanted);
  });
}

export interface HookPreview {
  readonly text: string;
  /** There is more than is shown. */
  readonly cut: boolean;
}

/** The start of a hook, cut at a word, for a card that has not been opened. */
export function hookPreview(text: string): HookPreview {
  if (text.length <= HOOK_PREVIEW_CHARS) return { text, cut: false };
  const start = text.slice(0, HOOK_PREVIEW_CHARS);
  const atWord = start.slice(0, Math.max(start.lastIndexOf(' '), 1));
  return { text: `${atWord}…`, cut: true };
}

export interface LibraryState {
  /** At least one opening has its words. */
  readonly built: boolean;
  /** Videos whose captions have not been read yet. */
  readonly toRead: number;
  readonly withWords: number;
  /** Openings with words that no AI has named yet. */
  readonly unnamed: number;
}

export function libraryState(hooks: readonly LibraryHook[]): LibraryState {
  const withWords = hooks.filter((hook) => hook.text !== null);
  return {
    built: withWords.length > 0,
    toRead: hooks.filter((hook) => hook.captions === 'not-read').length,
    withWords: withWords.length,
    unnamed: withWords.filter((hook) => hook.style === null).length,
  };
}

/** Why a video of the library has no words to show. */
export function withoutWords(hook: LibraryHook): string {
  if (hook.captions === 'none') return 'This video has no captions, so its opening cannot be read.';
  return hook.captions === 'not-read'
    ? 'Its captions have not been read yet. Press Build the hook library.'
    : 'Nothing is said in its first minute.';
}
