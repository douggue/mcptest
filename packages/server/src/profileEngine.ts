/** A stored channel's profile: its numbers and some of its videos, read from the store only. */
import {
  LOGO_SHOWN_MIN_WIDTH,
  loadChannelProfile,
  parseChannelRef,
  pickImage,
  type ChannelRepo,
  type ProfileDeps,
  type StoredChannel,
} from '@jgtube/core';
import { matchChannels, type SearchChannel } from '@jgtube/core/src/channel/search';
import type { ProfileEngine } from './profileTypes';

export interface ProfileEngineDeps {
  readonly now: () => Date;
  readonly repos: ProfileDeps & {
    readonly channels: Pick<ChannelRepo, 'findById' | 'findByHandle' | 'listAll'>;
  };
}

export function profileEngine({ now, repos }: ProfileEngineDeps): ProfileEngine {
  const listed = (channel: StoredChannel): SearchChannel => ({
    id: channel.id,
    title: channel.title,
    handle: channel.handle,
    subscribers: channel.subscribersHidden ? null : channel.subscribers,
  });
  /** The logo is read only for the few channels shown, never for every stored one. */
  const withLogo = (channel: SearchChannel): SearchChannel => ({
    ...channel,
    logoUrl:
      pickImage(repos.brands?.find(channel.id)?.avatar ?? [], LOGO_SHOWN_MIN_WIDTH)?.url ?? null,
  });
  return {
    findChannelProfile: (channelId) => loadChannelProfile(repos, channelId, now()),
    searchChannels: (words) =>
      matchChannels(words, repos.channels.listAll().map(listed)).map(withLogo),
    findStoredChannel(ref) {
      const parsed = parseChannelRef(ref);
      const found =
        parsed.kind === 'id'
          ? repos.channels.findById(parsed.id)
          : repos.channels.findByHandle(parsed.handle);
      return found ? withLogo(listed(found)) : null;
    },
  };
}
