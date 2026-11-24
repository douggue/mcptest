import type { ReactNode } from 'react';
import type { AiChoice } from './AiEngines';
import { isObjectPage, isOwnChannel, whereIs } from '../lib/places';
import { CHANNEL_TABS, VIDEO_TABS, type Route, type ViewId } from '../lib/routes';
import { BreakdownChannelTab } from './BreakdownChannelTab';
import { CREATE_VIEWS } from './CreateViews';
import { DesignSheet } from './DesignSheet';
import { HomeView } from './HomeView';
import { MY_CHANNEL_VIEWS } from './MyChannelViews';
import { ChannelPage } from './pages/ChannelPage';
import { VideoPage } from './pages/VideoPage';
import { RESEARCH_VIEWS } from './ResearchViews';
import { Settings } from './Settings';
import { PlaceHeader } from './shell/PlaceHeader';
import { STUDY_VIEWS } from './StudyViews';
import { VideoBreakdownTab } from './VideoBreakdownTab';
import { NeedsMap, type ViewDraw, type ViewParts } from './viewParts';

/** A mistyped address is shown back, but not at any length. */
const MAX_ADDRESS_SHOWN = 80;

const VIEW_DRAWS: Partial<Record<ViewId, ViewDraw>> = {
  ...RESEARCH_VIEWS,
  ...CREATE_VIEWS,
  ...STUDY_VIEWS,
  ...MY_CHANNEL_VIEWS,
};

const tabIn = <T extends string>(tabs: readonly T[], tab: string | undefined, first: T): T =>
  tabs.find((each) => each === tab) ?? first;

/** A channel's page: the one named, or the owner's own (its Overview, under My channel) when none is. */
function drawChannel(route: Route, parts: ViewParts): ReactNode {
  const centerId = parts.page.snapshot?.center.id ?? null;
  const channelId = route.channelId ?? centerId;
  if (channelId === null) return <NeedsMap view="channel" />;
  const own = isOwnChannel(route, centerId);
  const tab = own ? 'overview' : tabIn(CHANNEL_TABS, route.tab, 'overview');
  return <ChannelPage key={channelId} parts={parts} channelId={channelId} tab={tab} own={own} />;
}

function drawView(route: Route, parts: ViewParts, ai: AiChoice): ReactNode {
  if (route.view === 'channel') return drawChannel(route, parts);
  if (route.view === 'video' && route.videoId) {
    const tab = tabIn(VIDEO_TABS, route.tab, 'summary');
    return <VideoPage key={route.videoId} parts={parts} videoId={route.videoId} tab={tab} />;
  }
  if (route.view === 'settings') return <Settings ai={ai} />;
  if (route.view === 'design-system') return <DesignSheet />;
  if (route.view === 'breakdown') return <BreakdownChannelTab parts={parts} channelId={null} />;
  if (route.view === 'video-breakdown') return <VideoBreakdownTab parts={parts} />;
  const draw = VIEW_DRAWS[route.view];
  return draw ? draw(parts) : <HomeView {...parts} />;
}

/** Said above Today when the address typed has no screen: what happened, and where the owner is now. */
function NotFound({ address }: { readonly address: string }) {
  return (
    <div className="mx-auto w-full max-w-[1260px] px-4 pt-4 sm:px-8">
      <p
        role="status"
        className="rounded border border-line bg-card px-4 py-3 text-body-sm text-muted"
      >
        That page does not exist:{' '}
        <span className="break-all font-medium text-ink">
          {address.slice(0, MAX_ADDRESS_SHOWN)}
        </span>
        . This is Today instead.
      </p>
    </div>
  );
}

/**
 * The one screen the address names, under its place's name, tabs and pills;
 * nothing else is drawn. Another channel's page and a video's page show no
 * tabs of a place: each has its own way back and its own tabs.
 */
export function ViewHost({
  route,
  parts,
  ai,
  notFound,
}: {
  /** An address just typed or followed that no screen has; null otherwise. */
  readonly notFound: string | null;
  readonly route: Route;
  readonly parts: ViewParts;
  readonly ai: AiChoice;
}) {
  const center = parts.page.snapshot?.center ?? null;
  const centerId = center?.id ?? null;
  const where = whereIs(route, centerId);
  const ownPage = isObjectPage(route, centerId);
  return (
    <>
      {notFound !== null && <NotFound address={notFound} />}
      {where && !ownPage && (
        <PlaceHeader
          where={where}
          channelTitle={center?.title ?? null}
          compact={route.view === 'radar'}
        />
      )}
      {drawView(route, parts, ai)}
    </>
  );
}
