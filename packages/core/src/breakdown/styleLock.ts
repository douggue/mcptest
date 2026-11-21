import { CHANNEL_ID_PATTERN } from '../sources/parse';
import { PROMPT_MARKERS, splitMarked } from './parts';

/**
 * The style lock a channel's breakdown sets out in its picture part, and the
 * copy the owner keeps for their own channel when they choose to use it:
 * the lock as it stands, under a first line that names the channel it came
 * from, so the page can link back and a tool can say where it is from.
 */

const FROM_LINE = /^FROM CHANNEL: (UC[\w-]{22})\r?\n\r?\n?/;

/** The style lock between a picture part's marker lines; null when there is none. */
export const liftStyleLock = (pictureText: string): string | null =>
  splitMarked(pictureText, PROMPT_MARKERS.picture).marked;

/** The lock as it is kept for the owner's channel, naming where it came from. */
export function styleLockNote(fromChannelId: string, lock: string): string {
  if (!CHANNEL_ID_PATTERN.test(fromChannelId)) {
    throw new Error('A style lock names the channel it came from by its channel id');
  }
  return `FROM CHANNEL: ${fromChannelId}\n\n${lock.trim()}`;
}

/** A kept lock read back: the channel it came from, when it names one, and the lock. */
export function readStyleLock(note: string): {
  readonly fromChannelId: string | null;
  readonly text: string;
} {
  const match = FROM_LINE.exec(note);
  return match
    ? { fromChannelId: match[1] ?? null, text: note.slice(match[0].length).trim() }
    : { fromChannelId: null, text: note.trim() };
}
