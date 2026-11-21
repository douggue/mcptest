import type { SnapshotChannel } from '@jgtube/core';
// Only these files of the engine are loaded, never its index: the index would
// pull the store and the YouTube client into the browser bundle.
import {
  TAKEN_OFF_MIN_VIDEO_VIEWS,
  TAKEN_OFF_WINDOW_DAYS,
  mixSplit,
} from '@jgtube/core/src/map/mix';
import { formatCount } from './format';

type Group = SnapshotChannel['group'];

/** What a look-alike is called by its group, on a row and in the channel panel. */
export const GROUP_LABEL: Readonly<Record<Group, string>> = {
  'taken-off': 'Taken off',
  rising: 'Rising',
  neither: 'Neither',
};

type Mixed = Pick<SnapshotChannel, 'peer' | 'removed' | 'group'>;

/**
 * The split of the look-alikes the owner sees, in words: how many have already
 * taken off, how many are rising, and how many are neither. Null when no
 * channel is like the centre. The numbers are what the map holds, whatever mix
 * was aimed for.
 */
export function describeMix(channels: readonly Mixed[]): string | null {
  const lookalikes = channels.filter((channel) => channel.peer && !channel.removed);
  if (lookalikes.length === 0) return null;
  const { takenOff, rising, neither } = mixSplit(lookalikes, (channel) => channel.group);
  return [
    `${lookalikes.length} like yours: ${takenOff} taken off`,
    `${rising} rising`,
    ...(neither > 0 ? [`${neither} neither`] : []),
  ].join(', ');
}

/** Why a channel is in its group, with the figures the call rests on. */
export function describeGroup(
  channel: Pick<SnapshotChannel, 'group' | 'ninetyDayViews' | 'widelySeenUploads'>,
): string {
  if (channel.group === 'rising') {
    return 'Rising: its first upload is under three months old and it is already far above its size, with small totals so far.';
  }
  const figures = `${channel.widelySeenUploads} of its uploads in the last ${TAKEN_OFF_WINDOW_DAYS} days passed ${formatCount(TAKEN_OFF_MIN_VIDEO_VIEWS)} views, ${formatCount(channel.ninetyDayViews)} views in all.`;
  return channel.group === 'taken-off'
    ? `Taken off: ${figures}`
    : `Neither taken off nor rising: ${figures}`;
}
