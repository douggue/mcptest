/** A stored channel's profile: its numbers and some of its videos, read from the store only. */
import { loadChannelProfile, type ProfileDeps } from '@jgtube/core';
import type { ProfileEngine } from './profileTypes';

export interface ProfileEngineDeps {
  readonly now: () => Date;
  readonly repos: ProfileDeps;
}

export function profileEngine({ now, repos }: ProfileEngineDeps): ProfileEngine {
  return { findChannelProfile: (channelId) => loadChannelProfile(repos, channelId, now()) };
}
