/** One stored channel's profile, as the API sees it: any channel the store holds, by its id. */
import type { ChannelProfile } from '@jgtube/core';

export interface ProfileEngine {
  /** Reads the store only; null when the store does not hold the channel. */
  findChannelProfile(channelId: string): ChannelProfile | null;
}
