import type { FactsRepo, NewFacts } from '../repos/types';
import { loadNicheList, type NicheDeps } from './niches';

/**
 * Fills in what the web pages do not show for the channels on the niche list:
 * the day the account was created, its country and its total views, from the
 * official API with the owner's key.
 *
 * It runs after a refresh and after a keyword search, never when a page is
 * merely opened, and asks about each channel once.
 */

/**
 * Channels asked about in one go. The API takes fifty per request at one unit
 * of the key's 10,000 daily allowance each, so this is four units at most.
 */
export const MAX_FACTS_PER_RUN = 200;

export interface FactsDeps extends NicheDeps {
  readonly facts: FactsRepo;
  /** Reads the facts for these channels. In the app this is the official API with the owner's key. */
  readonly fetchFacts: (channelIds: readonly string[]) => Promise<readonly NewFacts[]>;
}

export interface FactsOutcome {
  /** Channels on the niche list that had never been asked about. */
  readonly asked: number;
  /** Of those, how many the API knew. */
  readonly added: number;
  /** Why the facts could not be read, or null when they were. */
  readonly problem: string | null;
}

/**
 * Reads the facts for the niche-list channels that lack them. A refusal (no
 * allowance left, no connection) is reported in the outcome, not thrown: the
 * refresh or search it follows has already done its work, and the channels
 * stay unasked for the next run.
 */
export async function fillNicheFacts(deps: FactsDeps, now: Date): Promise<FactsOutcome> {
  const listed = loadNicheList(deps, now).channels.map((channel) => channel.id);
  const missing = deps.facts.listMissing(listed).slice(0, MAX_FACTS_PER_RUN);
  if (missing.length === 0) return { asked: 0, added: 0, problem: null };
  try {
    const facts = await deps.fetchFacts(missing);
    deps.facts.record(missing, facts, now);
    return { asked: missing.length, added: facts.length, problem: null };
  } catch (error) {
    const problem = error instanceof Error ? error.message : String(error);
    return { asked: missing.length, added: 0, problem };
  }
}
