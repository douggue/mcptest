/** One stored channel's profile, as the API sees it: any channel the store holds, by its id. */
import type { ChannelProfile } from '@jgtube/core';
import type { SearchChannel } from '@jgtube/core/src/channel/search';

export interface ProfileEngine {
  /** Reads the store only; null when the store does not hold the channel. */
  findChannelProfile(channelId: string): ChannelProfile | null;
  /** The stored channels a few letters match, on any map or none; reads the store only. */
  searchChannels(words: string): readonly SearchChannel[];
  /**
   * The stored channel a channel id, an @handle or a channel link names; null
   * when the store has no row for it. Throws for text that names no channel.
   */
  findStoredChannel(ref: string): SearchChannel | null;
}
