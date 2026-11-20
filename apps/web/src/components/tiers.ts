import type { ScoreCaution, SnapshotChannel } from '@jgtube/core';

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

/** Short label and fuller explanation for a score that should be read with care. */
export const CAUTION_LABEL: Record<
  ScoreCaution,
  { readonly label: string; readonly detail: string }
> = {
  'few-videos': {
    label: 'Few videos to compare',
    detail:
      'This channel has too few other videos for a steady "usual". The score can swing a lot.',
  },
  'low-baseline': {
    label: 'Low usual views',
    detail:
      "Most of this channel's videos get very few views, so the multiple looks bigger than it is. Judge by the view count.",
  },
};
