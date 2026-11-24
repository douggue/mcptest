/**
 * The app's five places, as the rail and the phone's bottom bar show them,
 * the tabs inside each, and the screens inside a tab. Every screen belongs to
 * one tab of one place; Ask and Settings open from the top bar and belong to
 * none. A new screen adds a line in `routes.ts` and one entry here.
 */
import { VIEWS, myChannelHref, viewHref, type PlainView, type Route, type ViewId } from './routes';

/** A screen a tab can hold: any plain one, or the owner's own channel page. */
export type ScreenView = PlainView | 'channel';

export type PlaceId = 'today' | 'discover' | 'create' | 'style' | 'my-channel';

/** One screen of a tab, shown as a pill when the tab holds more than one. */
export interface Screen {
  readonly label: string;
  /** `channel` is the owner's own channel page. */
  readonly view: ScreenView;
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

const screen = (view: ScreenView, label: string = VIEWS[view].title): Screen => ({ label, view });
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
        screen('thumbnails'),
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
      tab('Ideas', screen('ideas', 'My ideas'), screen('comments')),
      tab('Scripts', screen('script', 'My scripts'), screen('risk')),
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
      tab('Library', screen('formats', 'Title formats'), screen('hooks')),
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
      tab('Videos', screen('own-videos')),
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

/** The screens of My channel that the tabs of the owner's own channel page are. */
const OWN_TABS: Readonly<Record<string, ScreenView>> = {
  videos: 'own-videos',
  thumbnails: 'own-videos',
  breakdown: 'own-breakdown',
};

/**
 * The route as My channel shows it: a tab of the owner's own channel page,
 * reached by its channel id, is that screen of My channel. Any other route
 * is itself.
 */
export function settled(route: Route, centerId: string | null): Route {
  if (!isOwnChannel(route, centerId)) return route;
  const view = OWN_TABS[route.tab ?? ''] ?? 'channel';
  return { view, channelId: null, anchor: null };
}

/** Whether the route is a page of its own, with its own way back and tabs: a video, or another channel. */
export const isObjectPage = (route: Route, centerId: string | null): boolean =>
  route.view === 'video' || (route.view === 'channel' && !isOwnChannel(route, centerId));

/**
 * Where the route on screen sits. Another channel's page and a video's page
 * belong to Discover, where they are found, and show no tabs of that place.
 */
export function whereIs(route: Route, centerId: string | null): Where | null {
  if (route.view === 'video') return whereOf('breakouts');
  if (route.view === 'channel' && !isOwnChannel(route, centerId)) return whereOf('competitors');
  return whereOf(route.view);
}

/** Where a screen's pill or tab leads. */
export const screenHref = (view: ScreenView): string =>
  view === 'channel' ? myChannelHref() : viewHref(view);

/** Where a tab leads: its first screen. */
export const tabHref = (each: Tab): string => screenHref(each.screens[0]?.view ?? 'home');

/** Where the rail's entry for a place leads: its first tab. */
export const placeHref = (place: Place): string => {
  const first = place.tabs[0];
  return first ? tabHref(first) : viewHref('home');
};

/** The last screen opened in each place, by its address. */
export type LastScreens = Readonly<Partial<Record<PlaceId, string>>>;

/**
 * Where the menu's entry for a place leads: back to the screen last open in
 * it, so a place is picked up where it was left. The entry of the place on
 * screen leads to its first tab, which is how to get back to the start.
 */
export const railHref = (place: Place, active: PlaceId | null, last: LastScreens): string =>
  place.id === active ? placeHref(place) : (last[place.id] ?? placeHref(place));

/** The last screens with the one on show noted under its place; a page of its own is not noted. */
export function noteScreen(
  last: LastScreens,
  route: Route,
  centerId: string | null,
  hash: string,
): LastScreens {
  const where = isObjectPage(route, centerId) ? null : whereIs(route, centerId);
  if (!where || last[where.place.id] === hash) return last;
  return { ...last, [where.place.id]: hash };
}

/** The place's one line, about the owner's channel when there is one. */
export const leadOf = (place: Place, channelTitle: string | null): string =>
  place.lead.replace('{channel}', channelTitle ?? 'your channel');

/** The name of the channel or video whose page is on screen, once it has been read. */
export interface PageName {
  /** The channel's or the video's id. */
  readonly id: string;
  readonly name: string;
}

/**
 * The browser tab's name: the screen, then its place. A screen that is its
 * tab's only one, or that shares its tab's name, is named by the tab.
 */
export function pageTitle(
  route: Route,
  centerId: string | null,
  named: PageName | null = null,
): string {
  const app = 'Jgtube';
  const where = whereIs(route, centerId);
  // A channel's or a video's own page is named after it, once its name has been read.
  const id = route.view === 'video' ? route.videoId : route.channelId;
  if (named && named.id === id && isObjectPage(route, centerId)) return `${named.name} · ${app}`;
  if (!where) return `${VIEWS[route.view].title} · ${app}`;
  if (isObjectPage(route, centerId)) {
    return `${VIEWS[route.view].title} · ${where.place.label} · ${app}`;
  }
  const { place, tab: each, screen: shown } = where;
  const several = each.screens.length > 1 && shown.label !== each.label;
  const name = several ? `${shown.label} · ${each.label}` : each.label;
  return name === place.label ? `${name} · ${app}` : `${name} · ${place.label} · ${app}`;
}
