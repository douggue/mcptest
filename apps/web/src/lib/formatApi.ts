/**
 * The format builder's part of the local server's API: the shelf of
 * ingredients. A button names its source; the server reads the source from
 * the store and works out what it rests on.
 */
import type { Ingredient, IngredientLayer } from '@jgtube/core';
import { apiCaller, type Fetch } from './api';

/** What an "Add to format" button names. */
export type IngredientSourceRequest =
  | {
      readonly kind: 'formula';
      readonly center: string;
      readonly id: number;
      readonly windowDays: number;
    }
  | { readonly kind: 'transfer-format' | 'transfer-idea'; readonly key: string }
  | { readonly kind: 'hook'; readonly center: string; readonly videoId: string }
  | {
      readonly kind: 'video';
      readonly use: 'video' | 'own-video' | 'thumbnail';
      readonly videoId: string;
      readonly center: string | null;
    }
  | { readonly kind: 'niche'; readonly channelId: string }
  | {
      readonly kind: 'breakdown-part';
      readonly channelId: string;
      readonly part: string;
      readonly layer: IngredientLayer | null;
    }
  | {
      readonly kind: 'teardown';
      readonly videoId: string;
      readonly section: string;
      readonly index: number;
    }
  | { readonly kind: 'link'; readonly url: string }
  | {
      readonly kind: 'note';
      readonly layer: IngredientLayer;
      readonly name: string;
      readonly text: string;
    }
  | {
      readonly kind: 'image' | 'clip';
      readonly layer: IngredientLayer;
      readonly name: string;
      readonly file: string;
    };

export const INGREDIENTS_PATH = '/api/format/ingredients';

export function createFormatApi(fetcher?: Fetch) {
  const { call, unwrap, send } = apiCaller(fetcher);
  return {
    async ingredients(): Promise<readonly Ingredient[]> {
      return unwrap<{ ingredients: Ingredient[] }>(await call(INGREDIENTS_PATH)).ingredients;
    },
    /** Puts the named source on the shelf; resolves with it (or the one already there). */
    async add(source: IngredientSourceRequest): Promise<Ingredient> {
      return unwrap<Ingredient>(await send(INGREDIENTS_PATH, source));
    },
    async setNote(id: number, note: string): Promise<void> {
      unwrap(await send(`${INGREDIENTS_PATH}/note`, { id, note }));
    },
    async remove(id: number): Promise<void> {
      unwrap(await send(`${INGREDIENTS_PATH}/remove`, { id }));
    },
  };
}

export type FormatApi = ReturnType<typeof createFormatApi>;
