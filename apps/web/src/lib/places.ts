/**
 * The app's five places, as the rail and the phone's bottom bar show them,
 * the tabs inside each, and the screens inside a tab. Every screen belongs to
 * one tab of one place; Ask and Settings open from the top bar and belong to
 * none. A new screen adds a line in `routes.ts` and one entry here.
 */
import { VIEWS, myChannelHref, viewHref, type Route, type ViewId } from './routes';

export type PlaceId = 'today' | 'discover' | 'create' | 'style' | 'my-channel';

/** One screen of a tab, shown as a pill when the tab holds more than one. */
export interface Screen {
  readonly label: string;
  /** `channel` is the owner's own channel page. */
  readonly view: ViewId;
}

export interface Tab {
  readonly label: string;
  /** The screens inside, the first opened by the tab. */
  readonly screens: readonly Screen[];
}

export interface Place {
  readonly id: PlaceId;
  readonly label: string;
  /** The name under the icon at the foot of a phone. */
  readonly short: string;
  /** One line under the place's name; `{channel}` is the owner's channel. */
  readonly lead: string;
  /** The tabs inside it, the first opened from the rail. */
  readonly tabs: readonly Tab[];
}

const screen = (view: ViewId, label: string = VIEWS[view].title): Screen => ({ label, view });
const tab = (label: string, ...screens: readonly Screen[]): Tab => ({ label, screens });

export const PLACES: readonly Place[] = [
  {
    id: 'today',
    label: 'Today',
    short: 'Today',
    lead: 'Your next step, and what changed around {channel}.',
    tabs: [tab('Next step', screen('home')), tab('Since your last look', screen('what-changed'))],
  },
  {
    id: 'discover',
    label: 'Discover',
    short: 'Discover',
    lead: 'What is working around {channel} right now.',
    tabs: [
      tab(
        'Videos',
        screen('breakouts'),
        screen('outlier-bank'),
        screen('transfers'),
        screen('video-breakdown'),
      ),
      tab(
        'Channels',
        screen('competitors'),
        screen('niches'),
        screen('same-topic'),
        screen('breakdown'),
      ),
      tab('Map', screen('radar')),
    ],
  },
  {
    id: 'create',
    label: 'Create',
    short: 'Create',
    lead: 'From an idea to a script you can record.',
    tabs: [
      tab('Ideas', screen('ideas'), screen('comments')),
      tab('Scripts', screen('script'), screen('risk')),
      tab('Plan', screen('calendar')),
    ],
  },
  {
    id: 'style',
    label: 'Style',
    short: 'Style',
    lead: 'Your own format, mixed from pieces that are proven to work.',
    tabs: [
      tab('My format', screen('format')),
      tab('Library', screen('formats'), screen('hooks')),
      tab('Bible', screen('bible')),
    ],
  },
  {
    id: 'my-channel',
    label: 'My channel',
    short: 'Channel',
    lead: 'How {channel} is doing.',
    tabs: [
      tab('Overview', screen('channel', 'Overview')),
      tab('Videos', screen('own-videos'), screen('thumbnails')),
      tab('Results', screen('pacing')),
      tab('Breakdown', screen('own-breakdown')),
    ],
  },
];

/** Where a screen sits: its place, its tab and itself. */
export interface Where {
  readonly place: Place;
  readonly tab: Tab;
  readonly screen: Screen;
}

/** Where a screen sits; null for Ask, Settings and the design sheet, which sit apart. */
export function whereOf(view: ViewId): Where | null {
  for (const place of PLACES) {
    for (const each of place.tabs) {
      const found = each.screens.find((candidate) => candidate.view === view);
      if (found) return { place, tab: each, screen: found };
    }
  }
  return null;
}

/** Whether a channel's page is the owner's own: no channel named, or the one the map is centred on. */
export const isOwnChannel = (route: Route, centerId: string | null): boolean =>
  route.view === 'channel' && (route.channelId === null || route.channelId === centerId);

/**
 * Where the route on screen sits. Another channel's page belongs to
 * Discover, where channels are found, and shows no tabs of its own place.
 */
export function whereIs(route: Route, centerId: string | null): Where | null {
  const where = whereOf(route.view);
  if (route.view !== 'channel' || isOwnChannel(route, centerId)) return where;
  return whereOf('competitors');
}

/** Where a screen's pill or tab leads. */
export const screenHref = (view: ViewId): string =>
  view === 'channel' ? myChannelHref() : viewHref(view);

/** Where a tab leads: its first screen. */
export const tabHref = (each: Tab): string => screenHref(each.screens[0]?.view ?? 'home');

/** Where the rail's entry for a place leads: its first tab. */
export const placeHref = (place: Place): string => {
  const first = place.tabs[0];
  return first ? tabHref(first) : viewHref('home');
};

/** The place's one line, about the owner's channel when there is one. */
export const leadOf = (place: Place, channelTitle: string | null): string =>
  place.lead.replace('{channel}', channelTitle ?? 'your channel');

/**
 * The browser tab's name: the screen, then its place. A screen that is its
 * tab's only one, or that shares its tab's name, is named by the tab.
 */
export function pageTitle(route: Route, centerId: string | null): string {
  const app = 'Jgtube';
  const where = whereIs(route, centerId);
  if (!where) return `${VIEWS[route.view].title} · ${app}`;
  if (route.view === 'channel' && !isOwnChannel(route, centerId)) {
    return `Channel · ${where.place.label} · ${app}`;
  }
  const { place, tab: each, screen: shown } = where;
  const several = each.screens.length > 1 && shown.label !== each.label;
  const name = several ? `${shown.label} · ${each.label}` : each.label;
  return name === place.label ? `${name} · ${app}` : `${name} · ${place.label} · ${app}`;
}
