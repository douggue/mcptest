import {
  findRecentIdea,
  loadTransferList,
  parseChannelRef,
  type ChannelRepo,
  type TransferDeps,
} from '@jgtube/core';
import type { Engine } from './app';

export interface TransferStore {
  readonly repos: TransferDeps & { readonly channels: ChannelRepo };
  readonly now: () => Date;
}

type Transfers = Pick<Engine, 'listTransfers' | 'setTransferSaved'>;

/** The transfer list and the ideas the owner saved from it; the store only. */
export function transfers({ repos, now }: TransferStore): Transfers {
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
  };
}
