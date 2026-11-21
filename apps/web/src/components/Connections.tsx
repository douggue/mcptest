import { createContext, useContext } from 'react';
import type { StyleLockView } from '../lib/answersApi';

/** A channel as the page names it. */
export interface NamedChannel {
  readonly id: string;
  readonly title: string;
}

/**
 * What one section can send to another: the links of the path from research
 * to a script. The page provides them; a section with none shows no such
 * buttons, so each section still works on its own.
 */
export interface Connections {
  /** Writes the open script in this channel's voice. */
  readonly useVoice: (channel: NamedChannel) => void;
  /** Why this channel's voice cannot be used now, or null when it can. */
  readonly voiceProblem: (channelId: string) => string | null;
  /** Takes a breakdown's title formulas into the idea lab. */
  readonly useFormulas: (channel: NamedChannel) => void;
  /** Uses a breakdown's style lock for the channel on screen. */
  readonly useStyleLock: (channel: NamedChannel) => void;
  /** The style lock in use for the channel on screen; null when none. */
  readonly styleLock: StyleLockView | null;
  readonly stopStyleLock: () => void;
  /** Brings the idea lab's concepts into view, to write thumbnail prompts in the reviewed style. */
  readonly useReviewStyle: () => void;
}

export const ConnectionsContext = createContext<Connections | null>(null);

/** The links of the page, or null where none are provided. */
export const useConnections = (): Connections | null => useContext(ConnectionsContext);
