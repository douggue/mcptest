/**
 * Finding a stored channel by a few typed letters or by its @handle. Pure:
 * the same matching runs over every stored channel on the server and over
 * the channels already on screen in the page.
 */

/** A channel as a search lists it. */
export interface SearchChannel {
  readonly id: string;
  readonly title: string;
  readonly handle: string | null;
  readonly subscribers: number | null;
  readonly logoUrl?: string | null;
}

/** Fewer letters than this match too much to be worth showing. */
export const MIN_SEARCH_CHARS = 2;
export const MAX_SEARCH_CHARS = 200;
/** How many channels a search lists. */
export const CHANNEL_HITS = 5;

const fold = (text: string): string => text.toLowerCase().normalize('NFKD');
const bare = (handle: string | null): string => fold((handle ?? '').replace(/^@/, ''));

/** How well a channel matches: 0 its name starts with the words, 1 a word of it does, 2 it holds them. */
function rank(channel: SearchChannel, words: string): number | null {
  const title = fold(channel.title);
  const handle = bare(channel.handle);
  if (title.startsWith(words) || handle.startsWith(words.replace(/^@/, ''))) return 0;
  if (title.split(/\s+/).some((word) => word.startsWith(words))) return 1;
  return title.includes(words) || (handle !== '' && handle.includes(words)) ? 2 : null;
}

/** The channels a few letters match, best first and the larger first among equals, each once. */
export function matchChannels<C extends SearchChannel>(
  query: string,
  channels: readonly C[],
  limit: number = CHANNEL_HITS,
): readonly C[] {
  const words = fold(query.trim());
  if (words.length < MIN_SEARCH_CHARS || words.length > MAX_SEARCH_CHARS) return [];
  const seen = new Set<string>();
  const ranked = channels.flatMap((channel) => {
    if (seen.has(channel.id)) return [];
    seen.add(channel.id);
    const at = rank(channel, words);
    return at === null ? [] : [{ channel, at }];
  });
  return [...ranked]
    .sort((a, b) => a.at - b.at || (b.channel.subscribers ?? 0) - (a.channel.subscribers ?? 0))
    .slice(0, limit)
    .map((entry) => entry.channel);
}

/** The channel whose @handle is the one named; null when none has it. */
export function channelOfHandle<C extends SearchChannel>(
  handle: string,
  channels: readonly C[],
): C | null {
  const wanted = bare(handle);
  return channels.find((channel) => bare(channel.handle) === wanted) ?? null;
}
