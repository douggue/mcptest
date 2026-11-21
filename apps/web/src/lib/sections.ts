/**
 * The app's five destinations, as the rail shows them, and the tabs inside
 * each. Every view belongs to one destination and shows as one of its tabs;
 * Settings opens from the top bar. A new view adds a line in `routes.ts` and
 * one tab here.
 */
import { channelHref, viewHref, type ViewId } from './routes';

export type DestinationId = 'home' | 'channel' | 'research' | 'create' | 'ask';

export interface Tab {
  readonly label: string;
  /** The view the tab opens; `channel` is the map's own channel page. */
  readonly view: Exclude<ViewId, 'home' | 'settings'>;
}

export interface Destination {
  readonly id: DestinationId;
  readonly label: string;
  /** The tabs inside it, the first opened from the rail; empty for a single view. */
  readonly tabs: readonly Tab[];
}

export const DESTINATIONS: readonly Destination[] = [
  { id: 'home', label: 'Home', tabs: [] },
  {
    id: 'channel',
    label: 'Channel',
    tabs: [
      { label: 'Overview', view: 'channel' },
      { label: 'Radar', view: 'radar' },
      { label: 'What changed', view: 'what-changed' },
      { label: 'Your videos', view: 'own-videos' },
      { label: 'Calendar', view: 'calendar' },
      { label: 'Pacing', view: 'pacing' },
      { label: 'Viewers ask', view: 'comments' },
    ],
  },
  {
    id: 'research',
    label: 'Research',
    tabs: [
      { label: 'Breaking out', view: 'breakouts' },
      { label: 'Formats', view: 'formats' },
      { label: 'Hooks', view: 'hooks' },
      { label: 'Same topic', view: 'same-topic' },
      { label: 'Thumbnails', view: 'thumbnails' },
      { label: 'Transfers', view: 'transfers' },
      { label: 'New niches', view: 'niches' },
    ],
  },
  {
    id: 'create',
    label: 'Create',
    tabs: [
      { label: 'Ideas', view: 'ideas' },
      { label: 'Script', view: 'script' },
      { label: 'Check', view: 'risk' },
    ],
  },
  { id: 'ask', label: 'Ask AI', tabs: [] },
];

/** The destination a view belongs to; null for Settings, which sits apart. */
export function destinationOf(view: ViewId): Destination | null {
  if (view === 'settings') return null;
  if (view === 'home') return DESTINATIONS[0] ?? null;
  if (view === 'ask') return DESTINATIONS.find((d) => d.id === 'ask') ?? null;
  return DESTINATIONS.find((d) => d.tabs.some((tab) => tab.view === view)) ?? null;
}

/**
 * Where a tab leads. The channel page is the map's own channel; with no map
 * yet it is Home, where a channel is chosen.
 */
export function tabHref(view: Tab['view'], centerId: string | null): string {
  if (view === 'channel') return centerId ? channelHref(centerId) : viewHref('home');
  return viewHref(view);
}

/** Where the rail's entry for a destination leads: its first tab, or its one view. */
export function destinationHref(destination: Destination, centerId: string | null): string {
  const first = destination.tabs[0];
  if (first) return tabHref(first.view, centerId);
  return viewHref(destination.id === 'ask' ? 'ask' : 'home');
}
