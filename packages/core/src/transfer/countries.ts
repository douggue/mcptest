import type { FactsRepo, NewFacts } from '../repos/types';
import { loadTransferList, type TransferDeps } from './transfers';
import type { TransferList } from './types';

/**
 * Reading the countries the transfer list rests on: the country of the
 * channel on screen and of each channel behind a listed idea, from the
 * official API with the owner's key. Each channel is asked about once.
 */

/** Channels asked about in one go: the API takes fifty a request at one unit each. */
export const MAX_COUNTRIES_PER_RUN = 200;

export interface CountryDeps extends TransferDeps {
  readonly facts: FactsRepo;
  /** Reads the facts for these channels. In the app this is the official API with the owner's key. */
  readonly fetchFacts: (channelIds: readonly string[]) => Promise<readonly NewFacts[]>;
}

export interface CountryOutcome {
  /** Channels that had never been asked about. */
  readonly asked: number;
  /** Of those, how many the API knew. */
  readonly added: number;
  /** Why the countries could not be read, or null when they were. */
  readonly problem: string | null;
}

/** The channels a transfer list rests on that the official API was never asked about. */
export function channelsLackingCountry(
  deps: Pick<TransferDeps, 'facts'>,
  list: Pick<TransferList, 'ideas'>,
  centerChannelId: string | null,
): readonly string[] {
  const behind = list.ideas.flatMap((idea) => idea.versions.map((version) => version.channelId));
  const wanted = [...new Set([...(centerChannelId ? [centerChannelId] : []), ...behind])];
  return deps.facts?.listMissing(wanted) ?? [];
}

/**
 * Reads the missing countries for the transfer list of the channel on screen
 * and stores them. A refusal (no allowance left, no connection) is reported
 * in the outcome, not thrown, and the channels stay unasked for the next try.
 */
export async function readCountries(
  deps: CountryDeps,
  now: Date,
  centerChannelId: string | null,
): Promise<CountryOutcome> {
  const list = loadTransferList(deps, now, { centerChannelId });
  const missing = channelsLackingCountry(deps, list, centerChannelId).slice(
    0,
    MAX_COUNTRIES_PER_RUN,
  );
  if (missing.length === 0) return { asked: 0, added: 0, problem: null };
  try {
    const facts = await deps.fetchFacts(missing);
    deps.facts.record(missing, facts, now);
    return { asked: missing.length, added: facts.length, problem: null };
  } catch (error) {
    return {
      asked: missing.length,
      added: 0,
      problem: error instanceof Error ? error.message : String(error),
    };
  }
}
