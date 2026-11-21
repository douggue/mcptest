/**
 * The app's views and their addresses. Each feature opens in a view of its
 * own, named in the address after `#/` (such as `#/ideas`), so the browser's
 * back and forward buttons and a reload keep the view. One channel's view is
 * `#/channel/<channel id>`. An older in-page link (`#idea-lab`, `#concept-12`)
 * still works: it opens the view that holds that element and scrolls to it.
 */

export const VIEWS = {
  home: { title: 'Home' },
  radar: { title: 'Radar' },
  'what-changed': { title: 'What changed' },
  breakouts: { title: 'Breaking out' },
  'same-topic': { title: 'Same topic' },
  thumbnails: { title: 'Thumbnails' },
  transfers: { title: 'Transfers' },
  niches: { title: 'New niches' },
  formats: { title: 'Formats' },
  hooks: { title: 'Hooks' },
  ideas: { title: 'Ideas' },
  script: { title: 'Script' },
  risk: { title: 'Check' },
  ask: { title: 'Ask AI' },
  'own-videos': { title: 'Your videos' },
  calendar: { title: 'Calendar' },
  pacing: { title: 'Pacing' },
  comments: { title: 'Viewers ask' },
  settings: { title: 'Settings' },
  channel: { title: 'Channel' },
} as const satisfies Readonly<Record<string, { readonly title: string }>>;

export type ViewId = keyof typeof VIEWS;

export interface Route {
  readonly view: ViewId;
  /** The channel of a channel's view; null for every other view. */
  readonly channelId: string | null;
  /** An element of the view to scroll to; null for the top. */
  readonly anchor: string | null;
}

export const HOME: Route = { view: 'home', channelId: null, anchor: null };

const CHANNEL_ID = /^UC[\w-]{22}$/;
/** An element id as the page writes them. */
const ELEMENT_ID = /^[a-z][a-z0-9_-]{0,80}$/i;

/**
 * Which view holds an element, by the start of its id: the id itself or the
 * id followed by a hyphen. Longer starts come before shorter ones they share.
 */
const ANCHOR_VIEWS: readonly (readonly [string, ViewId])[] = [
  ['top', 'radar'],
  ['what-changed', 'what-changed'],
  ['alerts', 'what-changed'],
  ['refresh', 'what-changed'],
  ['breakouts', 'breakouts'],
  ['same-topic', 'same-topic'],
  ['thumbnail-board', 'thumbnails'],
  ['transfers', 'transfers'],
  ['niches', 'niches'],
  ['formulas', 'formats'],
  ['hook-library', 'hooks'],
  ['hook', 'hooks'],
  ['idea-lab', 'ideas'],
  ['concept', 'ideas'],
  ['script-writer', 'script'],
  ['risk-check', 'risk'],
  ['ask-claude', 'ask'],
  ['breakdown', 'ask'],
  ['own-videos', 'own-videos'],
  ['upload-calendar', 'calendar'],
  ['length-pacing', 'pacing'],
  ['comment-mining', 'comments'],
  ['settings', 'settings'],
];

const isView = (name: string): name is ViewId => Object.hasOwn(VIEWS, name);

function anchorRoute(anchor: string): Route {
  if (!ELEMENT_ID.test(anchor)) return HOME;
  const owner = ANCHOR_VIEWS.find(([start]) => anchor === start || anchor.startsWith(`${start}-`));
  return owner ? { view: owner[1], channelId: null, anchor } : HOME;
}

function pathRoute(path: string): Route {
  const [name = '', id = ''] = path.split('/').filter(Boolean);
  if (name === 'channel') {
    return CHANNEL_ID.test(id) ? { view: 'channel', channelId: id, anchor: null } : HOME;
  }
  return isView(name) ? { view: name, channelId: null, anchor: null } : HOME;
}

/** The view an address names; the overview for anything it does not know. */
export function routeFromHash(hash: string): Route {
  const text = hash.startsWith('#') ? hash.slice(1) : hash;
  if (text === '') return HOME;
  return text.startsWith('/') ? pathRoute(text) : anchorRoute(text);
}

export const viewHref = (view: Exclude<ViewId, 'channel'>): string =>
  view === 'home' ? '#/' : `#/${view}`;

export const channelHref = (channelId: string): string => `#/channel/${channelId}`;

/** The address of a route: a view, a channel's view, or an element of a view. */
export function routeHash(route: Route): string {
  if (route.anchor) return `#${route.anchor}`;
  if (route.view === 'channel') return route.channelId ? channelHref(route.channelId) : '#/';
  return viewHref(route.view);
}
