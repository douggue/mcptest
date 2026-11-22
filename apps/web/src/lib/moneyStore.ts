/**
 * The verdicts the page has read, shared by every badge, button and filter so
 * a check made in one place shows everywhere. Each state is a new object, so
 * React can tell a change by identity.
 */
import type { MoneyProblem, MoneyVerdict } from '@jgtube/core';
import { MAX_CHECK_IDS, moneyChunks, type MoneyApi } from './money';

export interface MoneyState {
  readonly byId: ReadonlyMap<string, MoneyVerdict>;
  /** Channels a check is reading now. */
  readonly checking: ReadonlySet<string>;
  /** Why the last check or read failed, in the server's words; null when it did not. */
  readonly problem: string | null;
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : 'The request failed';

export function createMoneyStore(api: MoneyApi) {
  let state: MoneyState = { byId: new Map(), checking: new Set(), problem: null };
  const listeners = new Set<() => void>();
  const set = (changes: Partial<MoneyState>): void => {
    state = { ...state, ...changes };
    listeners.forEach((listener) => listener());
  };
  const merge = (verdicts: readonly MoneyVerdict[]): ReadonlyMap<string, MoneyVerdict> =>
    new Map([...state.byId, ...verdicts.map((verdict) => [verdict.channelId, verdict] as const)]);

  return {
    snapshot: (): MoneyState => state,

    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    /** Reads the stored verdicts of the ids not read yet, or all of them again when `again`. */
    async load(ids: readonly string[], again = false): Promise<void> {
      const wanted = again ? ids : ids.filter((id) => !state.byId.has(id));
      if (wanted.length === 0) return;
      try {
        set({ byId: merge(await api.verdicts(wanted)) });
      } catch (error) {
        set({ problem: messageOf(error) });
      }
    },

    /** Checks the channels, ten at a time, keeping every verdict found; answers the problems. */
    async check(ids: readonly string[]): Promise<readonly MoneyProblem[]> {
      const wanted = [...new Set(ids)].filter((id) => !state.checking.has(id));
      if (wanted.length === 0) return [];
      set({ checking: new Set([...state.checking, ...wanted]), problem: null });
      const problems: MoneyProblem[] = [];
      try {
        for (const part of moneyChunks(wanted, MAX_CHECK_IDS)) {
          const outcome = await api.check(part);
          problems.push(...outcome.problems);
          set({ byId: merge(outcome.verdicts) });
        }
      } catch (error) {
        set({ problem: messageOf(error) });
      } finally {
        set({ checking: new Set([...state.checking].filter((id) => !wanted.includes(id))) });
      }
      return problems;
    },
  };
}

export type MoneyStore = ReturnType<typeof createMoneyStore>;
