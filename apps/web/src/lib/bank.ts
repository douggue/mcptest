/**
 * The outlier bank as the page reads it: its part of the local server's API,
 * the filters as kept in this browser, and the words a card and the find
 * panel show. The filtering itself is done by the server over the whole bank.
 */
import type { BankCloseness, BankCollection, BankVideo } from '@jgtube/core';
import { BANK_GROUPS, type BankGroupId } from '@jgtube/core/src/bank/filters';
import {
  NO_BANK_FILTERS,
  bankQueryParams,
  parseBankQuery,
  type BankFilterState,
} from '@jgtube/core/src/bank/query';
import type { BankLook, FindInfo, FindResult } from '@jgtube/core/src/bank/view';
import { apiCaller, type Fetch } from './api';
import { formatAge, formatCount, formatDuration } from './format';

export type { BankLook, FindInfo, FindResult };
export const BANK_PATH = '/api/bank';

/** One stored video as its own page shows it. */
export interface BankVideoLook {
  readonly video: BankVideo;
  readonly collections: readonly BankCollection[];
  /** The collections that hold this video. */
  readonly saved: readonly number[];
}
/** The browser key the choice is kept under; versioned so a new shape starts afresh. */
export const BANK_FILTERS_KEY = 'jgtube.bankFilters.v1';

/** The state with one option chosen or let go; a single-choice group holds one at most. */
export function toggleBankChoice(
  state: BankFilterState,
  group: BankGroupId,
  key: string,
): BankFilterState {
  const chosen = state.chosen[group];
  const single = BANK_GROUPS.find((one) => one.id === group)?.single ?? false;
  const next = chosen.includes(key)
    ? chosen.filter((one) => one !== key)
    : single
      ? [key]
      : [...chosen, key];
  return { ...state, chosen: { ...state.chosen, [group]: next } };
}

/** How many groups and word boxes are in use. */
export const activeBankFilters = (state: BankFilterState): number =>
  BANK_GROUPS.filter((group) => state.chosen[group.id].length > 0).length +
  (state.contains.trim() !== '' ? 1 : 0) +
  (state.excludes.trim() !== '' ? 1 : 0);

/** No filters, keeping the order chosen. */
export const clearBankFilters = (state: BankFilterState): BankFilterState => ({
  ...NO_BANK_FILTERS,
  sort: state.sort,
});

export const savedBankText = (state: BankFilterState): string =>
  JSON.stringify(bankQueryParams(state));

/** The kept choice, read back through the same checks the server makes; none when unreadable. */
export function parseSavedBank(text: string | null): BankFilterState {
  if (text === null) return NO_BANK_FILTERS;
  try {
    const raw: unknown = JSON.parse(text);
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return NO_BANK_FILTERS;
    const pairs = Object.entries(raw).filter(
      (pair): pair is [string, string] => typeof pair[1] === 'string',
    );
    return parseBankQuery(new URLSearchParams(pairs));
  } catch {
    return NO_BANK_FILTERS;
  }
}

/** The address one page of the bank is read from. */
export function bankLookPath(
  state: BankFilterState,
  offset: number,
  limit: number,
  channelId?: string,
): string {
  const params = new URLSearchParams({
    ...bankQueryParams(state),
    // One channel's stored videos only, for its own page.
    ...(channelId === undefined ? {} : { channel: channelId }),
    offset: String(offset),
    limit: String(limit),
  });
  return `${BANK_PATH}?${params.toString()}`;
}

export const exportHref = (id: number, as: 'csv' | 'md'): string =>
  `${BANK_PATH}/collections/export?id=${id}&as=${as}`;

/** Views · age · length, as the card's meta line. */
export function videoMeta(
  video: Pick<BankVideo, 'views' | 'ageDays' | 'durationSeconds' | 'isShort'>,
): string {
  const length = video.isShort ? 'Short' : formatDuration(video.durationSeconds);
  return [`${formatCount(video.views)} views`, formatAge(video.ageDays), length]
    .filter((part) => part !== '')
    .join(' · ');
}

const TIER_WORD = { close: 'Close', medium: 'Medium', far: 'Far' } as const;

export const closenessText = (closeness: BankCloseness | null): string | null =>
  closeness ? `${TIER_WORD[closeness.tier]} to ${closeness.centerTitle}` : null;

const whole = new Intl.NumberFormat('en', { maximumFractionDigits: 0 });

/** What a find will cost at most, and what is left of today's cap, in one line. */
export function costLine(info: FindInfo): string {
  const { plan, allowance } = info;
  const left = `${whole.format(allowance.left)} of today’s ${whole.format(allowance.cap)} left.`;
  return plan.via === 'api'
    ? `Up to ${whole.format(plan.apiUnits)} units of your API key (${plan.requests} requests). ${left}`
    : `Up to ${whole.format(plan.requests)} page requests, signed out, at the usual pace. ${left}`;
}

export function createBankApi(fetcher?: Fetch) {
  const { call, unwrap, send } = apiCaller(fetcher);
  const collectionsOf = async (path: string, body: unknown) =>
    unwrap<{ collections: readonly BankCollection[] }>(await send(path, body)).collections;
  return {
    async look(
      state: BankFilterState,
      offset: number,
      limit: number,
      channelId?: string,
    ): Promise<BankLook> {
      return unwrap<BankLook>(await call(bankLookPath(state, offset, limit, channelId)));
    },
    /** The owner's collections, without reading the bank itself. */
    async collections(): Promise<readonly BankCollection[]> {
      return unwrap<{ collections: readonly BankCollection[] }>(
        await call(`${BANK_PATH}/collections`),
      ).collections;
    },
    /** One stored video with its score and the collections it is in; null when it is not stored. */
    async video(videoId: string): Promise<BankVideoLook | null> {
      return unwrap<{ found: BankVideoLook | null }>(
        await call(`${BANK_PATH}/video?video=${encodeURIComponent(videoId)}`),
      ).found;
    },
    async findInfo(channels: number): Promise<FindInfo & { jobId: string | null }> {
      return unwrap(await call(`${BANK_PATH}/find?channels=${channels}`));
    },
    async startFind(query: string, channels: number): Promise<string> {
      return unwrap<{ jobId: string }>(await send(`${BANK_PATH}/find`, { query, channels })).jobId;
    },
    async job(id: string): Promise<{
      readonly status: 'running' | 'done' | 'failed';
      readonly progress: { readonly text?: string } | null;
      readonly result: FindResult | null;
      readonly error: string | null;
    }> {
      return unwrap(await call(`/api/jobs/${encodeURIComponent(id)}`));
    },
    createCollection: (name: string) => collectionsOf(`${BANK_PATH}/collections/create`, { name }),
    deleteCollection: (id: number) => collectionsOf(`${BANK_PATH}/collections/delete`, { id }),
    addToCollection: (id: number, video: string) =>
      collectionsOf(`${BANK_PATH}/collections/add`, { id, video }),
    removeFromCollection: (id: number, video: string) =>
      collectionsOf(`${BANK_PATH}/collections/remove`, { id, video }),
  };
}

export type BankApi = ReturnType<typeof createBankApi>;
