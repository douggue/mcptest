/**
 * What the Ask panel knows about the screen it opened over: the channel the
 * answers are about (the one the map is centred on) and, when another
 * channel's page is on screen, that channel, offered as a way to start the
 * question. The AI answers from the map's stored data either way.
 */
import type { Route } from './routes';

export interface ContextChannel {
  readonly id: string;
  readonly title: string;
  readonly logoUrl?: string | null;
}

export interface AskContext {
  /** The channel every answer is about. */
  readonly about: ContextChannel;
  /** After the channel's name: how much stored data stands behind it. */
  readonly scope: string;
  /** Another channel on screen, which the question can be started with; null when none. */
  readonly subject: ContextChannel | null;
}

interface MapParts {
  readonly center: ContextChannel;
  readonly channels: readonly ContextChannel[];
}

const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`;

/** The channel a route is about, when it is one of the map's and not its centre. */
function subjectOf(route: Route, map: MapParts): ContextChannel | null {
  const id = route.view === 'channel' || route.view === 'breakdown' ? route.channelId : null;
  if (id === null || id === map.center.id) return null;
  return map.channels.find((channel) => channel.id === id) ?? null;
}

/** What Ask is about on this screen; null before any map, when there is nothing to ask about. */
export function askContext(route: Route, map: MapParts | null): AskContext | null {
  if (!map) return null;
  const { id, title, logoUrl } = map.center;
  return {
    about: { id, title, logoUrl },
    scope: `and its map of ${plural(map.channels.length, 'channel')}`,
    subject: subjectOf(route, map),
  };
}

/** The words a question about the channel on screen starts with. */
export const starterFor = (subject: ContextChannel): string => `About ${subject.title}: `;

/** The question box's hint, naming the channel on screen when there is one. */
export const askPlaceholder = (context: AskContext): string =>
  context.subject
    ? `Ask about ${context.subject.title}, or this map`
    : 'Ask about this map, a channel or a video';
