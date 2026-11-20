import type { MapSnapshot, ThumbnailBoard } from '@jgtube/core';
import { useEffect, useState } from 'react';
import type { Api } from '../lib/api';

export type BoardState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly board: ThumbnailBoard }
  | { readonly status: 'failed'; readonly message: string };

const IDLE: BoardState = { status: 'idle' };
const LOADING: BoardState = { status: 'loading' };

/**
 * The thumbnail board for the map on screen. It is read again whenever the map
 * is (a new map, a competitor removed or restored), and the board already shown
 * stays up meanwhile so the page does not jump.
 */
export function useThumbnailBoard(api: Api, snapshot: MapSnapshot | null): BoardState {
  const [state, setState] = useState<BoardState>(IDLE);
  const centerId = snapshot?.center.id ?? null;

  useEffect(() => {
    if (centerId === null) {
      setState(IDLE);
      return;
    }
    let current = true;
    setState((previous) =>
      previous.status === 'ready' && previous.board.center.id === centerId ? previous : LOADING,
    );
    api
      .thumbnailBoard(centerId)
      .then((board) => {
        if (current) setState(board ? { status: 'ready', board } : IDLE);
      })
      .catch((error: unknown) => {
        if (!current) return;
        const message =
          error instanceof Error ? error.message : 'The thumbnails could not be loaded';
        setState({ status: 'failed', message });
      });
    return () => {
      current = false;
    };
    // `snapshot` changes identity on every read of the map, which is when to read again.
  }, [api, centerId, snapshot]);

  return state;
}
