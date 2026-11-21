import type { ScoreCaution, SnapshotChannel } from '@jgtube/core';
import { PEER_DORMANT_AFTER_DAYS } from '@jgtube/core/src/limits';

/** How close a competitor is, in plain words: how often YouTube recommends it beside the channel. */
export const TIER_LABEL: Readonly<Record<SnapshotChannel['tier'], string>> = {
  close: 'Close',
  medium: 'Medium',
  far: 'Far',
};

/** Why a channel on the map is not counted as one like the centre. */
export const OUTSIDE_LABEL: Readonly<
  Record<NonNullable<SnapshotChannel['outsideReason']>, string>
> = {
  larger: 'Far larger than a channel like yours',
  dormant: `No upload in the last ${PEER_DORMANT_AFTER_DAYS} days`,
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
