/**
 * The screens, each group in a file of its own that the browser fetches the
 * first time one of its screens opens. The first page load then fetches the
 * shell and the screen on it, not every screen of the app.
 */
import { lazy, Suspense, type ComponentType, type ReactNode } from 'react';
import type { ViewId } from '../lib/routes';
import type { ViewDraw, ViewParts } from './viewParts';

type Table = Partial<Record<ViewId, ViewDraw>>;

interface GroupProps {
  readonly view: ViewId;
  readonly parts: ViewParts;
}

/** A group of screens drawn from its table, once its file has arrived. */
const group = (load: () => Promise<Table>) =>
  lazy(async () => {
    const table = await load();
    function Group({ view, parts }: GroupProps) {
      const draw = table[view];
      return <>{draw ? draw(parts) : null}</>;
    }
    return { default: Group };
  });

const GROUPS = {
  research: group(() => import('./ResearchViews').then((m) => m.RESEARCH_VIEWS)),
  create: group(() => import('./CreateViews').then((m) => m.CREATE_VIEWS)),
  study: group(() => import('./StudyViews').then((m) => m.STUDY_VIEWS)),
  myChannel: group(() => import('./MyChannelViews').then((m) => m.MY_CHANNEL_VIEWS)),
};

/** Which group each screen of the tables is in; kept in step with the tables by a test. */
export const VIEW_GROUPS: Partial<Record<ViewId, keyof typeof GROUPS>> = {
  radar: 'research',
  'what-changed': 'research',
  'same-topic': 'research',
  thumbnails: 'research',
  niches: 'research',
  formats: 'create',
  hooks: 'create',
  ideas: 'create',
  script: 'create',
  format: 'create',
  risk: 'create',
  ask: 'study',
  'own-videos': 'study',
  calendar: 'study',
  pacing: 'study',
  comments: 'study',
  competitors: 'myChannel',
  'own-breakdown': 'myChannel',
  bible: 'myChannel',
};

/** One screen of the tables, or null for a screen that is in none. */
export function tableView(view: ViewId, parts: ViewParts): ReactNode {
  const name = VIEW_GROUPS[view];
  if (name === undefined) return null;
  const Group = GROUPS[name];
  return <Group view={view} parts={parts} />;
}

/** A screen of its own, fetched when first drawn. */
export function lazyNamed<P extends object>(
  load: () => Promise<ComponentType<P>>,
): ComponentType<P> {
  return lazy(async () => ({ default: await load() }));
}

export const HomeView = lazyNamed(() => import('./HomeView').then((m) => m.HomeView));
export const ChannelPage = lazyNamed(() =>
  import('./pages/ChannelPage').then((m) => m.ChannelPage),
);
export const VideoPage = lazyNamed(() => import('./pages/VideoPage').then((m) => m.VideoPage));
export const Settings = lazyNamed(() => import('./Settings').then((m) => m.Settings));
export const DesignSheet = lazyNamed(() => import('./DesignSheet').then((m) => m.DesignSheet));
export const BreakdownChannelTab = lazyNamed(() =>
  import('./BreakdownChannelTab').then((m) => m.BreakdownChannelTab),
);
/** Discover › Videos: its saved views share one row and one grid, in one file. */
export const DiscoverVideos = lazyNamed(() =>
  import('./discover/DiscoverVideos').then((m) => m.DiscoverVideos),
);
export const AskPanel = lazyNamed(() => import('./shell/AskPanel').then((m) => m.AskPanel));

/**
 * Said in the moment a screen's file is on its way; usually too short to see.
 * A `quiet` one (a panel) shows nothing meanwhile.
 */
export function Arriving({
  children,
  quiet = false,
}: {
  readonly children: ReactNode;
  readonly quiet?: boolean;
}) {
  const waiting = quiet ? null : (
    <p role="status" className="px-4 py-space-lg text-body-sm text-muted sm:px-8">
      Opening…
    </p>
  );
  return <Suspense fallback={waiting}>{children}</Suspense>;
}
