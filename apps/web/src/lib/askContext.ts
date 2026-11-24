/**
 * What the Ask panel is about on the screen it opened over, and what the AI
 * will read to answer. On another channel's page it is that channel; on a
 * video's page that video; anywhere else the owner's channel and its map.
 * The id of the channel or video on screen goes with the question, so "this
 * video" and "this channel" mean the one on screen. Every answer is read
 * from stored data through the map's read-only tools, and the words here say
 * only what those tools reach.
 */
import type { Route } from './routes';

export interface ContextChannel {
  readonly id: string;
  readonly title: string;
  readonly logoUrl?: string | null;
}

/** What the panel says it is about: the chip after "About". */
export interface AskChip {
  readonly kind: 'map' | 'channel' | 'video';
  /** The channel's or video's id; the map's own channel for the map. */
  readonly id: string;
  /** Its name as the chip reads. */
  readonly title: string;
  readonly logoUrl?: string | null;
}

export interface AskContext {
  /** The channel whose map the answers are read from. */
  readonly center: ContextChannel;
  readonly chip: AskChip;
  /** After the chip: what the AI reads to answer, in a few true words. */
  readonly reads: string;
  /** Said under it when the screen holds something the AI cannot read; null otherwise. */
  readonly cannot: string | null;
}

/** What goes with a question so the AI knows what was on screen: ids only. */
export interface AskAbout {
  readonly channelId?: string;
  readonly videoId?: string;
}

interface MapParts {
  readonly center: ContextChannel;
  readonly channels: readonly ContextChannel[];
}

const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`;

/** The screens that hold the owner's own writing, which the AI's tools do not reach. */
const WRITING_VIEWS: ReadonlySet<Route['view']> = new Set(['script', 'risk', 'ideas']);

function chipOf(route: Route, map: MapParts): AskChip {
  if (route.view === 'video' && route.videoId) {
    return { kind: 'video', id: route.videoId, title: 'This video' };
  }
  const id = route.view === 'channel' ? route.channelId : null;
  if (id !== null && id !== map.center.id) {
    const known = map.channels.find((channel) => channel.id === id);
    return {
      kind: 'channel',
      id,
      title: known?.title ?? 'This channel',
      logoUrl: known?.logoUrl ?? null,
    };
  }
  const { title, logoUrl } = map.center;
  return { kind: 'map', id: map.center.id, title, logoUrl };
}

function readsOf(chip: AskChip, map: MapParts): string {
  if (chip.kind === 'video')
    return `read from your stored videos and the map of ${map.center.title}`;
  if (chip.kind === 'channel')
    return `read from its stored videos and the map of ${map.center.title}`;
  return `and its map of ${plural(map.channels.length, 'channel')}`;
}

/** What Ask is about on this screen; null before any map, when there is nothing to ask about. */
export function askContext(route: Route, map: MapParts | null): AskContext | null {
  if (!map) return null;
  const chip = chipOf(route, map);
  return {
    center: map.center,
    chip,
    reads: readsOf(chip, map),
    cannot: WRITING_VIEWS.has(route.view)
      ? 'The AI reads stored channels and videos, not your ideas or scripts.'
      : null,
  };
}

/** What goes with the question; nothing when it is about the map. */
export function askAbout(context: AskContext | null): AskAbout | undefined {
  const chip = context?.chip;
  if (!chip || chip.kind === 'map') return undefined;
  return chip.kind === 'video' ? { videoId: chip.id } : { channelId: chip.id };
}

/** The question box's hint, naming what the panel is about. */
export function askPlaceholder(context: AskContext): string {
  const { chip } = context;
  if (chip.kind === 'video') return 'Ask about this video';
  if (chip.kind === 'channel')
    return `Ask about ${chip.title === 'This channel' ? 'this channel' : chip.title}`;
  return 'Ask about this map, a channel or a video';
}

/** Before the quick questions when the panel is about something else: they are about the whole map. */
export const quickLabel = (context: AskContext): string | null =>
  context.chip.kind === 'map' ? null : `About the whole map of ${context.center.title}:`;
