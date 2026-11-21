/**
 * The style lock the owner uses for their own channel: taken, when they
 * press for it, from the picture part of a stored breakdown, and kept for
 * their channel with the channel it came from. A later question (a script
 * draft, a concept's thumbnail prompt) reads it through get_channel_note.
 */
import {
  liftStyleLock,
  parseChannelRef,
  readStyleLock,
  styleLockNote,
  type BreakdownRepo,
  type ChannelNoteRepo,
  type ChannelRepo,
} from '@jgtube/core';

/** The lock as the page shows it, with where it came from. */
export interface StyleLockView {
  readonly channelId: string;
  /** The channel whose breakdown it was taken from; null when that is not known. */
  readonly from: { readonly id: string; readonly title: string } | null;
  readonly text: string;
  readonly writtenAt: string;
}

export interface StyleLockEngine {
  /** The lock kept for a channel; null when none is. Reads the store only. */
  findStyleLock(channel: string): StyleLockView | null;
  /** Keeps the style lock of `from`'s breakdown for `channel`. Throws when there is none to keep. */
  useStyleLock(channel: string, from: string): StyleLockView;
  /** Stops using a lock for the channel. */
  stopStyleLock(channel: string): void;
}

export interface StyleLockDeps {
  readonly now: () => Date;
  readonly repos: {
    readonly channels: Pick<ChannelRepo, 'findById' | 'findByHandle'>;
    readonly breakdowns: Pick<BreakdownRepo, 'find'>;
    readonly notes: ChannelNoteRepo;
  };
}

const NOT_STORED = 'That channel is not stored in Jgtube.';
const NO_LOCK =
  'That channel’s breakdown has no style lock: its picture part found no consistent picture style, or has not been written.';

export function styleLockEngine({ now, repos }: StyleLockDeps): StyleLockEngine {
  const stored = (channel: string) => {
    try {
      const ref = parseChannelRef(channel);
      return ref.kind === 'id'
        ? repos.channels.findById(ref.id)
        : repos.channels.findByHandle(ref.handle);
    } catch {
      return null;
    }
  };
  const find = (channel: string): StyleLockView | null => {
    const owner = stored(channel);
    const note = owner ? repos.notes.find(owner.id, 'style-lock') : null;
    if (!owner || !note) return null;
    const { fromChannelId, text } = readStyleLock(note.text);
    const from = fromChannelId ? repos.channels.findById(fromChannelId) : null;
    return {
      channelId: owner.id,
      from: from ? { id: from.id, title: from.title } : null,
      text,
      writtenAt: note.writtenAt.toISOString(),
    };
  };
  return {
    findStyleLock: find,

    useStyleLock(channel, fromRef) {
      const owner = stored(channel);
      const from = stored(fromRef);
      if (!owner || !from) throw new Error(NOT_STORED);
      const part = repos.breakdowns.find(from.id, 'picture');
      const lock = part?.written ? liftStyleLock(part.text) : null;
      if (!part?.written || lock === null) throw new Error(NO_LOCK);
      repos.notes.save(
        {
          channelId: owner.id,
          kind: 'style-lock',
          engine: part.engine,
          text: styleLockNote(from.id, lock),
        },
        now(),
      );
      const kept = find(owner.id);
      if (kept === null) throw new Error('The style lock could not be kept');
      return kept;
    },

    stopStyleLock(channel) {
      const owner = stored(channel);
      if (owner) repos.notes.remove(owner.id, 'style-lock');
    },
  };
}
