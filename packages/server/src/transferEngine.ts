import {
  findRecentIdea,
  loadTransferList,
  parseChannelRef,
  placeForKey,
  readCountries,
  type ChannelFacts,
  type ChannelRepo,
  type CountryOutcome,
  type FactsRepo,
  type OwnerPlaceRepo,
  type TransferDeps,
} from '@jgtube/core';
import type { Engine } from './app';
import { cleanMessage } from './jobs';

export interface TransferStore {
  readonly repos: TransferDeps & {
    readonly channels: ChannelRepo;
    readonly facts: FactsRepo;
    readonly ownerPlaces: OwnerPlaceRepo;
  };
  readonly now: () => Date;
  /**
   * Reads channel facts from the official API, or null when the owner has set
   * no key. Asked for at each use, so a key saved while Jgtube runs is found.
   */
  readonly factsFetcher: () =>
    ((channelIds: readonly string[]) => Promise<readonly ChannelFacts[]>) | null;
}

/** The part of the engine that settles which place a channel's ideas are judged for. */
export interface TransferPlaceEngine {
  /** Whether channel countries can be read: it needs the owner's YouTube API key. */
  canReadCountries(): boolean;
  /**
   * Reads, from the official API, the countries the channel's transfer list
   * lacks: its own and those of the channels behind the listed ideas. Null
   * when the channel is not stored or no key is set.
   */
  readCountries(channel: string): Promise<CountryOutcome | null>;
  /**
   * Stores the place the owner chose for a channel, or removes the choice
   * (null). False when the channel is not stored or the place is not one
   * Jgtube knows.
   */
  setOwnerPlace(channel: string, placeKey: string | null): boolean;
}

type Transfers = Pick<Engine, 'listTransfers' | 'setTransferSaved'> & TransferPlaceEngine;

/** The transfer list, the ideas the owner saved from it, and the place it is judged for. */
export function transfers({ repos, now, factsFetcher }: TransferStore): Transfers {
  /** The stored channel a handle, link or id refers to; null when it is not stored. */
  const storedId = (channel: string): string | null => {
    const ref = parseChannelRef(channel);
    const stored =
      ref.kind === 'id' ? repos.channels.findById(ref.id) : repos.channels.findByHandle(ref.handle);
    return stored?.id ?? null;
  };
  return {
    listTransfers(choices = {}) {
      return loadTransferList(repos, now(), {
        ownerPlace: choices.place ?? null,
        centerChannelId: choices.channel === undefined ? null : storedId(choices.channel),
      });
    },

    setTransferSaved(key, saved) {
      if (!saved) {
        repos.transfers.setSaved(key, key, false, now());
        return true;
      }
      // Only an idea some recent video has can be saved; its title is kept with it.
      const idea = findRecentIdea(repos, now(), key);
      if (!idea) return false;
      repos.transfers.setSaved(idea.key, idea.template, true, now());
      return true;
    },

    canReadCountries: () => factsFetcher() !== null,

    async readCountries(channel) {
      const centerId = storedId(channel);
      const fetchFacts = factsFetcher();
      if (centerId === null || fetchFacts === null) return null;
      const outcome = await readCountries({ ...repos, fetchFacts }, now(), centerId);
      // The reason goes to the browser, so it is cleaned.
      return {
        ...outcome,
        problem: outcome.problem === null ? null : cleanMessage(outcome.problem),
      };
    },

    setOwnerPlace(channel, placeKey) {
      const centerId = storedId(channel);
      if (centerId === null) return false;
      if (placeKey !== null && placeForKey(placeKey) === null) return false;
      repos.ownerPlaces.set(centerId, placeKey, now());
      return true;
    },
  };
}
