import type { Ingredient } from '@jgtube/core';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createFormatApi, type IngredientSourceRequest } from '../lib/formatApi';

export type ShelfState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly items: readonly Ingredient[] }
  | { readonly status: 'failed'; readonly message: string };

export interface Shelf {
  readonly state: ShelfState;
  /** Puts a source on the shelf; resolves with the reason when it could not. */
  readonly add: (source: IngredientSourceRequest) => Promise<string | null>;
  readonly remove: (id: number) => void;
  readonly setNote: (id: number, note: string) => void;
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** The format builder's shelf, read when the view opens and kept in step with each change. */
export function useShelf(): Shelf {
  const api = useMemo(() => createFormatApi(), []);
  const [state, setState] = useState<ShelfState>({ status: 'loading' });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let current = true;
    api
      .ingredients()
      .then((items) => current && setState({ status: 'ready', items }))
      .catch(
        (error: unknown) => current && setState({ status: 'failed', message: messageOf(error) }),
      );
    return () => {
      current = false;
    };
  }, [api, version]);

  const reload = useCallback(() => setVersion((value) => value + 1), []);
  const add = useCallback(
    async (source: IngredientSourceRequest) => {
      try {
        await api.add(source);
        reload();
        return null;
      } catch (error) {
        return messageOf(error);
      }
    },
    [api, reload],
  );
  const remove = useCallback(
    (id: number) => void api.remove(id).then(reload, reload),
    [api, reload],
  );
  const setNote = useCallback(
    (id: number, note: string) => void api.setNote(id, note).then(reload, reload),
    [api, reload],
  );
  return { state, add, remove, setNote };
}
