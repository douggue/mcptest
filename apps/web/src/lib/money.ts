/**
 * The monetization signs as the page shows them: badge words and colours, the
 * tooltip naming the sign and when it was read, the list filter, and the calls
 * to the local server. The verdicts themselves are worked out by the server
 * from stored signs; nothing here judges.
 */
import type { MoneyCheckOutcome, MoneyStatus, MoneyVerdict } from '@jgtube/core';
import { apiCaller, type Fetch } from './api';

export type MoneyFilter = 'any' | 'monetized' | 'not-yet';

export const MONEY_FILTERS: readonly { readonly id: MoneyFilter; readonly label: string }[] = [
  { id: 'any', label: 'Any' },
  { id: 'monetized', label: 'Only monetized' },
  { id: 'not-yet', label: 'Not yet monetized' },
];

/** The most ids one read asks for, as the server allows. */
export const MAX_READ_IDS = 200;
/** The most channels one check asks for, as the server allows. */
export const MAX_CHECK_IDS = 10;

export const BADGE_TONE: Readonly<Record<MoneyStatus, string>> = {
  monetized: 'bg-primary-container/20 text-primary',
  likely: 'bg-secondary-container/30 text-secondary',
  'not-yet': 'bg-surface-container-high text-on-surface-variant',
  'no-sign': 'bg-surface-container text-on-surface-variant',
  'not-checked': 'bg-surface-container text-outline',
};

const day = (iso: string): string => iso.slice(0, 10);

/** The words behind a badge: the verdict, the sign it rests on and when, and the subscriber bar. */
export function moneyTooltip(verdict: MoneyVerdict): string {
  const bar = `${verdict.bar.says}. ${verdict.bar.note}`;
  if (verdict.status === 'not-checked' || verdict.checkedAt === null) {
    return `Not checked: press "Check monetization" on the channel's page. ${bar}`;
  }
  const video = verdict.videoId ? ` from video ${verdict.videoId}` : '';
  return `${verdict.says}. ${verdict.sign ?? ''} Read ${day(verdict.checkedAt)}${video}. ${bar}`;
}

/**
 * Whether a channel passes the filter. "Only monetized" keeps the channels
 * with a sign of memberships, never those with ads alone; a channel never
 * checked passes neither, since nothing is known of it.
 */
export function matchesMoney(verdict: MoneyVerdict | undefined, filter: MoneyFilter): boolean {
  if (filter === 'any') return true;
  return verdict?.status === filter;
}

export function filterByMoney<T>(
  items: readonly T[],
  idOf: (item: T) => string,
  byId: ReadonlyMap<string, MoneyVerdict>,
  filter: MoneyFilter,
): readonly T[] {
  return filter === 'any'
    ? items
    : items.filter((item) => matchesMoney(byId.get(idOf(item)), filter));
}

/** Why a filtered list may be short: how many of its channels were never checked. */
export function uncheckedNote(
  ids: readonly string[],
  byId: ReadonlyMap<string, MoneyVerdict>,
  filter: MoneyFilter,
): string | null {
  if (filter === 'any') return null;
  const unchecked = ids.filter((id) => (byId.get(id)?.status ?? 'not-checked') === 'not-checked');
  if (unchecked.length === 0) return null;
  const noun = unchecked.length === 1 ? 'channel is' : 'channels are';
  return `${unchecked.length} ${noun} not checked yet and left out. Check them to sort them in.`;
}

const chunks = <T>(items: readonly T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size),
  );

/** The monetization part of the local server's API. */
export function createMoneyApi(fetcher?: Fetch) {
  const { call, unwrap, send } = apiCaller(fetcher);
  return {
    /** The stored verdicts of the stored channels among the ids. */
    async verdicts(ids: readonly string[]): Promise<readonly MoneyVerdict[]> {
      const parts = await Promise.all(
        chunks([...new Set(ids)], MAX_READ_IDS).map(async (part) => {
          const envelope = await call(`/api/money?channels=${part.join(',')}`);
          return unwrap<{ verdicts: MoneyVerdict[] }>(envelope).verdicts;
        }),
      );
      return parts.flat();
    },

    /** Reads one watch page per channel (at most ten) and answers what was found. */
    async check(ids: readonly string[]): Promise<MoneyCheckOutcome> {
      return unwrap<MoneyCheckOutcome>(await send('/api/money/check', { channels: ids }));
    },
  };
}

export type MoneyApi = ReturnType<typeof createMoneyApi>;
export { chunks as moneyChunks };
