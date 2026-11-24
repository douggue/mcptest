/**
 * The app's screens and their addresses. Every screen has a name (its view)
 * and one address after `#/`, written as the place it sits in, the tab and,
 * when a tab holds several screens, the screen: `#/discover/videos/bank`.
 * The browser's back and forward buttons and a reload keep the screen.
 *
 * Addresses from before the five places still open their screen, in its new
 * place: `#/radar` is `#/discover/map`, `#/hooks` is `#/style/library/hooks`.
 * An older in-page link (`#idea-lab`, `#concept-12`) opens the screen that
 * holds that element and scrolls to it.
 *
 * A channel and a video each have a page of their own, with tabs:
 * `#/channel/<channel id>/breakdown`, `#/video/<video id>/teardown`.
 */

export const VIEWS = {
  home: { title: 'Today' },
  'what-changed': { title: 'Since your last look' },
  breakouts: { title: 'Breaking out' },
  'outlier-bank': { title: 'All-time bank' },
  transfers: { title: 'Other languages' },
  'video-breakdown': { title: 'Studied videos' },
  competitors: { title: 'My competitors' },
  niches: { title: 'New niches' },
  'same-topic': { title: 'Same topic' },
  breakdown: { title: 'Suggested to study' },
  radar: { title: 'Map' },
  ideas: { title: 'Ideas' },
  comments: { title: 'What viewers ask' },
  script: { title: 'Scripts' },
  risk: { title: 'Check' },
  calendar: { title: 'Plan' },
  format: { title: 'My format' },
  formats: { title: 'Titles' },
  hooks: { title: 'Hooks' },
  bible: { title: 'Bible' },
  'own-videos': { title: 'Videos' },
  thumbnails: { title: 'Winning thumbnails' },
  pacing: { title: 'Results' },
  'own-breakdown': { title: 'Breakdown' },
  ask: { title: 'Ask' },
  settings: { title: 'Settings' },
  'design-system': { title: 'Design system' },
  channel: { title: 'Channel' },
  video: { title: 'Video' },
} as const satisfies Readonly<Record<string, { readonly title: string }>>;

export type ViewId = keyof typeof VIEWS;
/** Every screen but a channel's or a video's page, whose address carries which one. */
export type PlainView = Exclude<ViewId, 'channel' | 'video'>;

/** The tabs of a channel's page, the first shown when none is named. */
export const CHANNEL_TABS = ['overview', 'videos', 'thumbnails', 'breakdown'] as const;
export type ChannelTab = (typeof CHANNEL_TABS)[number];
/** The tabs of a video's page, the first shown when none is named. */
export const VIDEO_TABS = ['summary', 'teardown', 'thumbnail', 'hook'] as const;
export type VideoTab = (typeof VIDEO_TABS)[number];

export interface Route {
  readonly view: ViewId;
  /** The channel of a channel's page (null there is the owner's own); null for every other screen. */
  readonly channelId: string | null;
  /** The video of a video's page; left out on every other screen. */
  readonly videoId?: string;
  /** The tab of a channel's or a video's page, when it is not the first. */
  readonly tab?: ChannelTab | VideoTab;
  /** An element of the screen to scroll to; null for the top. */
  readonly anchor: string | null;
}

export const HOME: Route = { view: 'home', channelId: null, anchor: null };

/** The address of each screen, after `#/`. */
export const PATHS: Readonly<Record<PlainView, string>> = {
  home: 'today',
  'what-changed': 'today/changes',
  breakouts: 'discover/videos',
  'outlier-bank': 'discover/videos/bank',
  transfers: 'discover/videos/other-languages',
  'video-breakdown': 'discover/videos/studied',
  competitors: 'discover/channels',
  niches: 'discover/channels/new-niches',
  'same-topic': 'discover/channels/same-topic',
  breakdown: 'discover/channels/study',
  radar: 'discover/map',
  ideas: 'create/ideas',
  comments: 'create/ideas/viewers-ask',
  script: 'create/scripts',
  risk: 'create/scripts/check',
  calendar: 'create/plan',
  format: 'style/my-format',
  formats: 'style/library',
  hooks: 'style/library/hooks',
  bible: 'style/bible',
  'own-videos': 'my-channel/videos',
  thumbnails: 'discover/channels/thumbnails',
  pacing: 'my-channel/results',
  'own-breakdown': 'my-channel/breakdown',
  ask: 'ask',
  settings: 'settings',
  'design-system': 'design-system',
};

/** The owner's own channel page, whichever channel that is. */
const MY_CHANNEL = 'my-channel';

/** A place named alone opens its first screen. */
const PLACE_PATHS: Readonly<Record<string, PlainView>> = {
  discover: 'breakouts',
  create: 'ideas',
  style: 'format',
};

/** The addresses of the first step of the five places that have since moved. */
const MOVED_PATHS: Readonly<Record<string, PlainView>> = {
  'discover/videos/one-video': 'video-breakdown',
  'my-channel/videos/thumbnails': 'thumbnails',
};

const VIEW_OF_PATH: ReadonlyMap<string, PlainView> = new Map([
  ...Object.entries(PLACE_PATHS),
  ...Object.entries(MOVED_PATHS),
  ...(Object.entries(PATHS) as [PlainView, string][]).map(([view, path]) => [path, view] as const),
]);

const CHANNEL_ID = /^UC[\w-]{22}$/;
const VIDEO_ID = /^[\w-]{11}$/;
/** The old in-page link to one video's thumbnail review. */
const REVIEW_ANCHOR = /^thumbnail-review-([\w-]{11})$/;
/** An element id as the page writes them. */
const ELEMENT_ID = /^[a-z][a-z0-9_-]{0,80}$/i;

/**
 * Which screen holds an element, by the start of its id: the id itself or the
 * id followed by a hyphen. Longer starts come before shorter ones they share.
 */
const ANCHOR_VIEWS: readonly (readonly [string, ViewId])[] = [
  ['top', 'radar'],
  ['what-changed', 'what-changed'],
  ['alerts', 'what-changed'],
  ['refresh', 'what-changed'],
  ['breakouts', 'breakouts'],
  ['outlier-bank', 'outlier-bank'],
  ['same-topic', 'same-topic'],
  ['thumbnail-board', 'thumbnails'],
  ['thumbnail-review', 'thumbnails'],
  ['transfers', 'transfers'],
  ['niches', 'niches'],
  ['formulas', 'formats'],
  ['hook-library', 'hooks'],
  ['hook', 'hooks'],
  ['idea-lab', 'ideas'],
  ['concept', 'ideas'],
  ['script-writer', 'script'],
  ['risk-check', 'risk'],
  ['format-builder', 'format'],
  ['ask-claude', 'ask'],
  ['breakdown', 'breakdown'],
  ['own-videos', 'own-videos'],
  ['upload-calendar', 'calendar'],
  ['length-pacing', 'pacing'],
  ['comment-mining', 'comments'],
  ['settings', 'settings'],
];

const isView = (name: string): name is ViewId => Object.hasOwn(VIEWS, name);
const plain = (view: PlainView): Route => ({ view, channelId: null, anchor: null });

const isChannelTab = (tab: string): tab is ChannelTab =>
  (CHANNEL_TABS as readonly string[]).includes(tab);
const isVideoTab = (tab: string): tab is VideoTab =>
  (VIDEO_TABS as readonly string[]).includes(tab);

/** A channel's page on one of its tabs; Today for anything that is not a channel id. */
function channelRoute(id: string, tab: string): Route {
  if (!CHANNEL_ID.test(id)) return HOME;
  const route: Route = { view: 'channel', channelId: id, anchor: null };
  return isChannelTab(tab) && tab !== 'overview' ? { ...route, tab } : route;
}

/** A video's page on one of its tabs; Today for anything that is not a video id. */
function videoRoute(id: string, tab: string): Route {
  if (!VIDEO_ID.test(id)) return HOME;
  const route: Route = { view: 'video', channelId: null, anchor: null, videoId: id };
  return isVideoTab(tab) && tab !== 'summary' ? { ...route, tab } : route;
}

function anchorRoute(anchor: string): Route {
  if (!ELEMENT_ID.test(anchor)) return HOME;
  const reviewed = REVIEW_ANCHOR.exec(anchor)?.[1];
  if (reviewed) return videoRoute(reviewed, 'thumbnail');
  const owner = ANCHOR_VIEWS.find(([start]) => anchor === start || anchor.startsWith(`${start}-`));
  return owner ? { view: owner[1], channelId: null, anchor } : HOME;
}

/**
 * A channel to study: its page's Breakdown tab when the last part is a
 * channel id, the list of channels to study otherwise.
 */
function studyRoute(id: string): Route {
  return CHANNEL_ID.test(id) ? channelRoute(id, 'breakdown') : plain('breakdown');
}

/** An address from before the five places: the screen's own name after the slash. */
function oldRoute(name: string, id: string): Route | null {
  if (name === 'breakdown') return studyRoute(id);
  if (name === 'home') return HOME;
  return isView(name) && name !== 'channel' && name !== 'video' ? plain(name) : null;
}

function pathRoute(path: string): Route {
  const parts = path.split('/').filter(Boolean);
  const whole = parts.join('/');
  if (whole === MY_CHANNEL) return { view: 'channel', channelId: null, anchor: null };
  const known = VIEW_OF_PATH.get(whole);
  if (known) return plain(known);
  if (parts[0] === 'channel') return channelRoute(parts[1] ?? '', parts[2] ?? '');
  if (parts[0] === 'video') return videoRoute(parts[1] ?? '', parts[2] ?? '');
  if (parts.length === 4 && parts.slice(0, 3).join('/') === PATHS.breakdown) {
    return studyRoute(parts[3] ?? '');
  }
  return oldRoute(parts[0] ?? '', parts[1] ?? '') ?? HOME;
}

/** The screen an address names; Today for anything it does not know. */
export function routeFromHash(hash: string): Route {
  const text = hash.startsWith('#') ? hash.slice(1) : hash;
  if (text === '') return HOME;
  return text.startsWith('/') ? pathRoute(text) : anchorRoute(text);
}

export const viewHref = (view: PlainView): string => `#/${PATHS[view]}`;

/** One channel's page, on a tab when one is named. */
export const channelHref = (channelId: string, tab?: ChannelTab): string =>
  `#/channel/${channelId}${tab && tab !== 'overview' ? `/${tab}` : ''}`;

/** One video's page, on a tab when one is named. */
export const videoHref = (videoId: string, tab?: VideoTab): string =>
  `#/video/${videoId}${tab && tab !== 'summary' ? `/${tab}` : ''}`;

/** The owner's own channel page. */
export const myChannelHref = (): string => `#/${MY_CHANNEL}`;

/**
 * Where a channel is broken down: the Breakdown tab of its page, or the list
 * of channels to study when none is given. The address for a "Break it down"
 * button anywhere in the app; the owner presses Break it down there.
 */
export const breakdownHref = (channelId?: string | null): string =>
  channelId && CHANNEL_ID.test(channelId)
    ? channelHref(channelId, 'breakdown')
    : viewHref('breakdown');

/** The addresses that mean Today, after `#/`. */
const HOME_PATHS: ReadonlySet<string> = new Set(['', 'home', PATHS.home]);

/**
 * Whether an address names no screen at all: it is opened as Today, and the
 * page says that the address was not found rather than jumping silently.
 */
export function isUnknownAddress(hash: string): boolean {
  if (!hash.startsWith('#/')) return false;
  const path = hash.slice(2).split('/').filter(Boolean).join('/');
  return !HOME_PATHS.has(path) && routeFromHash(hash).view === 'home';
}

/** The route's tab when it is one of its page's own; none otherwise. */
function tabOf<T extends string>(route: Route, is: (tab: string) => tab is T): T | undefined {
  const { tab } = route;
  return tab !== undefined && is(tab) ? tab : undefined;
}

/** The address of a route: a screen, a channel's page, or an element of a screen. */
export function routeHash(route: Route): string {
  if (route.anchor) return `#${route.anchor}`;
  if (route.view === 'channel') {
    if (!route.channelId) return myChannelHref();
    return channelHref(route.channelId, tabOf(route, isChannelTab));
  }
  if (route.view === 'video') {
    if (!route.videoId) return viewHref('home');
    return videoHref(route.videoId, tabOf(route, isVideoTab));
  }
  return viewHref(route.view);
}

/**
 * The address to show for the one typed or followed: an address from before
 * the five places becomes the new one of the same screen. Null when the
 * address is already right, or is an in-page link, which is kept as it is.
 */
export function redirectOf(hash: string): string | null {
  if (!hash.startsWith('#/')) return null;
  const canonical = routeHash(routeFromHash(hash));
  return canonical === hash ? null : canonical;
}
