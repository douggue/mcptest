import type { BankCollection, BankVideo } from '@jgtube/core';
import type { BankFilterState, BankPage } from '@jgtube/core/src/bank/query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BANK_FILTERS_KEY, createBankApi, parseSavedBank, savedBankText } from '../lib/bank';
import { requestCounter } from '../lib/requests';

const bankApi = createBankApi();
export const BANK_PAGE = 24;
/** Typing in the title boxes waits this long before the bank is asked again. */
const WORDS_WAIT_MS = 300;

function readSaved(): BankFilterState {
  try {
    return parseSavedBank(window.localStorage.getItem(BANK_FILTERS_KEY));
  } catch {
    return parseSavedBank(null);
  }
}

export interface BankModel {
  readonly state: BankFilterState;
  readonly update: (change: (state: BankFilterState) => BankFilterState) => void;
  /** The first page's counts and options; null until read. */
  readonly page: BankPage | null;
  /** Every card loaded so far, page after page. */
  readonly videos: readonly BankVideo[];
  readonly collections: readonly BankCollection[];
  readonly setCollections: (collections: readonly BankCollection[]) => void;
  /** The collections a loaded video is in. */
  readonly savedOf: (videoId: string) => readonly number[];
  readonly setSaved: (videoId: string, collections: readonly number[]) => void;
  readonly loading: boolean;
  readonly problem: string | null;
  readonly more: () => void;
  readonly reload: () => void;
}

export interface BankOptions {
  /**
   * The filters to open with, for a view with filters of its own (a
   * collection, a saved view, one channel's videos). Left out, the bank
   * opens with the filters last used, and keeps them in this browser.
   */
  readonly initial?: BankFilterState;
  /** Only this channel's stored videos, for its own page. */
  readonly channelId?: string;
}

/** The bank as the view shows it: the filters, the pages read, the collections. */
export function useBank(options: BankOptions = {}): BankModel {
  const { initial, channelId } = options;
  const remembered = initial === undefined && channelId === undefined;
  const [state, setState] = useState<BankFilterState>(() => initial ?? readSaved());
  const [asked, setAsked] = useState<BankFilterState>(state);
  const [page, setPage] = useState<BankPage | null>(null);
  const [videos, setVideos] = useState<readonly BankVideo[]>([]);
  const [collections, setCollections] = useState<readonly BankCollection[]>([]);
  const [saved, setSavedMap] = useState<Readonly<Record<string, readonly number[]>>>({});
  const [loading, setLoading] = useState(true);
  const [problem, setProblem] = useState<string | null>(null);
  const [round, setRound] = useState(0);
  const counter = useMemo(requestCounter, []);
  const loaded = useRef(0);

  useEffect(() => {
    try {
      if (remembered) window.localStorage.setItem(BANK_FILTERS_KEY, savedBankText(state));
    } catch {
      // A private window or blocked storage: the filters still work, they are just not kept.
    }
    const wait = window.setTimeout(() => setAsked(state), WORDS_WAIT_MS);
    return () => window.clearTimeout(wait);
  }, [state, remembered]);

  const read = useCallback(
    (offset: number) => {
      const current = counter.begin();
      setLoading(true);
      bankApi
        .look(asked, offset, BANK_PAGE, channelId)
        .then((look) => {
          if (!current()) return;
          setProblem(null);
          setPage(look.page);
          setCollections(look.collections);
          setSavedMap((known) => (offset === 0 ? look.saved : { ...known, ...look.saved }));
          setVideos((shown) => (offset === 0 ? look.page.videos : [...shown, ...look.page.videos]));
          loaded.current = offset + look.page.videos.length;
        })
        .catch((error: unknown) => {
          if (current()) setProblem(error instanceof Error ? error.message : String(error));
        })
        .finally(() => {
          if (current()) setLoading(false);
        });
    },
    [asked, counter, channelId],
  );

  useEffect(() => read(0), [read, round]);

  const update = useCallback(
    (change: (state: BankFilterState) => BankFilterState) => setState(change),
    [],
  );
  return {
    state,
    update,
    page,
    videos,
    collections,
    setCollections,
    savedOf: (videoId) => saved[videoId] ?? [],
    setSaved: (videoId, ids) => setSavedMap((known) => ({ ...known, [videoId]: ids })),
    loading,
    problem,
    more: () => read(loaded.current),
    reload: () => setRound((value) => value + 1),
  };
}
