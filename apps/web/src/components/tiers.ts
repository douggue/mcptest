import type { SnapshotChannel } from '@jgtube/core';

/** The design's names for the three closeness tiers. */
export const TIER_LABEL: Readonly<Record<SnapshotChannel['tier'], string>> = {
  close: 'Close orbit',
  medium: 'Mid orbit',
  far: 'Distant orbit',
};

/** Why a channel on the map is not counted as one like the centre. */
export const OUTSIDE_LABEL: Readonly<
  Record<NonNullable<SnapshotChannel['outsideReason']>, string>
> = {
  larger: 'Far larger than a channel like yours',
  cadence: 'Publishes many times a day',
  length: 'Its videos are a very different length',
  titles: 'Its titles are unlike yours',
};
