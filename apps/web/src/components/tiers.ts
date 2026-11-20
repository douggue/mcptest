import type { SnapshotChannel } from '@jgtube/core';

/** The design's names for the three closeness tiers. */
export const TIER_LABEL: Readonly<Record<SnapshotChannel['tier'], string>> = {
  close: 'Close orbit',
  medium: 'Mid orbit',
  far: 'Distant orbit',
};
