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
 */

export const VIEWS = {
  home: { title: 'Today' },
  'what-changed': { title: 'Since your last look' },
  breakouts: { title: 'Breaking out' },
  'outlier-bank': { title: 'All-time bank' },
  transfers: { title: 'Other languages' },
  'video-breakdown': { title: 'One video' },
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
  thumbnails: { title: 'Thumbnails' },
  pacing: { title: 'Results' },
  'own-breakdown': { title: 'Breakdown' },
  ask: { title: 'Ask' },
  settings: { title: 'Settings' },
  'design-system': { title: 'Design system' },
  channel: { title: 'Channel' },
} as const satisfies Readonly<Record<string, { readonly title: string }>>;

export type ViewId = keyof typeof VIEWS;
/** Every screen but a channel's page, whose address carries the channel. */
export type PlainView = Exclude<ViewId, 'channel'>;

export interface Route {
  readonly view: ViewId;
  /**
   * The channel of a channel's page (null there is the owner's own channel),
   * or the channel open in "Suggested to study"; null for every other screen.
   */
  readonly channelId: string | null;
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
  'video-breakdown': 'discover/videos/one-video',
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
  thumbnails: 'my-channel/videos/thumbnails',
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

const VIEW_OF_PATH: ReadonlyMap<string, PlainView> = new Map([
  ...Object.entries(PLACE_PATHS),
  ...(Object.entries(PATHS) as [PlainView, string][]).map(([view, path]) => [path, view] as const),
]);

const CHANNEL_ID = /^UC[\w-]{22}$/;
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

function anchorRoute(anchor: string): Route {
  if (!ELEMENT_ID.test(anchor)) return HOME;
  const owner = ANCHOR_VIEWS.find(([start]) => anchor === start || anchor.startsWith(`${start}-`));
  return owner ? { view: owner[1], channelId: null, anchor } : HOME;
}

/** "Suggested to study", opened on one channel when the last part is a channel id. */
function studyRoute(id: string): Route {
  return { view: 'breakdown', channelId: CHANNEL_ID.test(id) ? id : null, anchor: null };
}

/** An address from before the five places: the screen's own name after the slash. */
function oldRoute(name: string, id: string): Route | null {
  if (name === 'channel') {
    return CHANNEL_ID.test(id) ? { view: 'channel', channelId: id, anchor: null } : HOME;
  }
  if (name === 'breakdown') return studyRoute(id);
  if (name === 'home') return HOME;
  return isView(name) && name !== 'channel' ? plain(name) : null;
}

function pathRoute(path: string): Route {
  const parts = path.split('/').filter(Boolean);
  const whole = parts.join('/');
  if (whole === MY_CHANNEL) return { view: 'channel', channelId: null, anchor: null };
  const known = VIEW_OF_PATH.get(whole);
  if (known) return plain(known);
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

/** One channel's page. */
export const channelHref = (channelId: string): string => `#/channel/${channelId}`;

/** The owner's own channel page. */
export const myChannelHref = (): string => `#/${MY_CHANNEL}`;

/**
 * "Suggested to study", opened on one channel when given: the address for a
 * "Break it down" button anywhere in the app. The owner presses Break it
 * down there.
 */
export const breakdownHref = (channelId?: string | null): string =>
  channelId && CHANNEL_ID.test(channelId)
    ? `${viewHref('breakdown')}/${channelId}`
    : viewHref('breakdown');

/** The address of a route: a screen, a channel's page, or an element of a screen. */
export function routeHash(route: Route): string {
  if (route.anchor) return `#${route.anchor}`;
  if (route.view === 'channel') {
    return route.channelId ? channelHref(route.channelId) : myChannelHref();
  }
  if (route.view === 'breakdown') return breakdownHref(route.channelId);
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
