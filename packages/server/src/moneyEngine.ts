/** Whether channels earn from YouTube, as far as public signs show: read from the store, or checked on request. */
import { checkMoney, loadMoneyVerdicts, type MoneyDeps, type WatchPageSource } from '@jgtube/core';
import type { MoneyEngine } from './moneyTypes';

export interface MoneyEngineDeps {
  readonly now: () => Date;
  readonly repos: Pick<MoneyDeps, 'channels' | 'videos' | 'money'>;
  /** YouTube, connected on first use. */
  readonly source: WatchPageSource;
  /** Runs work that reads YouTube under the store's lease. */
  readonly reading: <T>(work: () => Promise<T>) => Promise<T>;
}

export function moneyEngine({ now, repos, source, reading }: MoneyEngineDeps): MoneyEngine {
  return {
    findMoney: (channelIds) => loadMoneyVerdicts(repos, channelIds),
    checkMoney: (channelIds) => reading(() => checkMoney({ ...repos, source, now }, channelIds)),
  };
}
