import type { SameTopicList } from '@jgtube/core';

/** Channels shown before "show more". */
export const SAME_TOPIC_PAGE_SIZE = 6;

/** In plain words, what the list holds and who decides about it. */
export function describeSameTopic(list: SameTopicList, centerTitle: string): string {
  const count = list.channels.length;
  if (count === 0) {
    return list.kept.length > 0
      ? 'You have decided on every channel that fits on size and pace but uses different words.'
      : 'No channel on this map fits on size and pace and was left out for its wording alone.';
  }
  const one = count === 1;
  return [
    `${count} ${one ? 'channel' : 'channels'} on this map ${one ? 'fits' : 'fit'} ${centerTitle} on size and pace,`,
    `but ${one ? 'its' : 'their'} titles use different words, so the filter left ${one ? 'it' : 'them'} out.`,
    'If one covers your subject in its own words, keep it as a competitor.',
    'You decide, or your Claude does through the connector. Closest wording first.',
  ].join(' ');
}

/** How many channels are not shown because they are in another alphabet; null when none. */
export function describeOtherAlphabet(count: number): string | null {
  if (count === 0) return null;
  return count === 1
    ? '1 more is written in another alphabet than yours and is not shown.'
    : `${count} more are written in another alphabet than yours and are not shown.`;
}
