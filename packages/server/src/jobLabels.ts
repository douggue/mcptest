/**
 * The plain names a job is listed under: "Checking claims for <concept>",
 * "Making a map of <channel>". A name is read from the store when the job
 * starts; a name that cannot be read never stops the job, it is only plainer.
 */
import type { JobLabel } from './jobs';

const CHANNEL_ID = /^UC[\w-]{22}$/;
const LONGEST_NAME = 80;

/** What a label reads its names from: the saved channels and the stored concepts. */
export interface NameSource {
  listSavedChannels(): readonly { readonly id: string; readonly title: string }[];
  findConcept(
    channel: string,
    conceptId: number,
  ): { readonly concept: { readonly title: string } } | null;
}

function safely<T>(read: () => T, fallback: T): T {
  try {
    return read();
  } catch {
    return fallback;
  }
}

const shorten = (text: string): string =>
  text.length > LONGEST_NAME ? `${text.slice(0, LONGEST_NAME - 1)}…` : text;

/** A channel's saved title, else the reference as given. */
export function channelName(names: NameSource, channel: string): string {
  const saved = safely(() => names.listSavedChannels().find(({ id }) => id === channel), undefined);
  return shorten(saved?.title ?? channel);
}

/** A concept's title, else "a concept". */
export function conceptName(names: NameSource, channel: string, conceptId: number): string {
  const title = safely(() => names.findConcept(channel, conceptId)?.concept.title ?? null, null);
  return typeof title === 'string' ? `“${shorten(title)}”` : 'a concept';
}

/** The channel id a reference is, or null for a handle or a link. */
const idOf = (channel: string): string | null => (CHANNEL_ID.test(channel) ? channel : null);

/** A job about one channel: `<doing> <channel name>`. */
export function channelLabel(
  names: NameSource,
  kind: string,
  doing: string,
  channel: string,
): JobLabel {
  return { kind, title: `${doing} ${channelName(names, channel)}`, channelId: idOf(channel) };
}

/** A job about one concept of a channel: `<doing> <concept title>`. */
export function conceptLabel(
  names: NameSource,
  kind: string,
  doing: string,
  channel: string,
  conceptId: number,
): JobLabel {
  return {
    kind,
    title: `${doing} ${conceptName(names, channel, conceptId)}`,
    channelId: idOf(channel),
    conceptId,
  };
}
