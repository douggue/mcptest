import type { ReactNode } from 'react';
import type { AiChoice } from './AiEngines';
import { whereIs } from '../lib/places';
import type { Route, ViewId } from '../lib/routes';
import { BreakdownChannelTab } from './BreakdownChannelTab';
import { ChannelView } from './ChannelView';
import { CREATE_VIEWS } from './CreateViews';
import { DesignSheet } from './DesignSheet';
import { HomeView } from './HomeView';
import { MY_CHANNEL_VIEWS } from './MyChannelViews';
import { RESEARCH_VIEWS } from './ResearchViews';
import { Settings } from './Settings';
import { PlaceHeader } from './shell/PlaceHeader';
import { STUDY_VIEWS } from './StudyViews';
import { VideoBreakdownTab } from './VideoBreakdownTab';
import { NeedsMap, type ViewDraw, type ViewParts } from './viewParts';

const VIEW_DRAWS: Partial<Record<ViewId, ViewDraw>> = {
  ...RESEARCH_VIEWS,
  ...CREATE_VIEWS,
  ...STUDY_VIEWS,
  ...MY_CHANNEL_VIEWS,
};

/** A channel's page: the one named, or the owner's own when none is. */
function drawChannel(route: Route, parts: ViewParts): ReactNode {
  const channelId = route.channelId ?? parts.page.snapshot?.center.id ?? null;
  if (channelId === null) return <NeedsMap view="channel" />;
  return <ChannelView key={channelId} {...parts} channelId={channelId} />;
}

function drawView(route: Route, parts: ViewParts, ai: AiChoice): ReactNode {
  if (route.view === 'channel') return drawChannel(route, parts);
  if (route.view === 'settings') return <Settings ai={ai} />;
  if (route.view === 'design-system') return <DesignSheet />;
  if (route.view === 'breakdown') {
    return <BreakdownChannelTab parts={parts} channelId={route.channelId} />;
  }
  if (route.view === 'video-breakdown') return <VideoBreakdownTab parts={parts} />;
  const draw = VIEW_DRAWS[route.view];
  return draw ? draw(parts) : <HomeView {...parts} />;
}

/**
 * The one screen the address names, under its place's name, tabs and pills;
 * nothing else is drawn. Another channel's page shows no tabs: it has its
 * own way back.
 */
export function ViewHost({
  route,
  parts,
  ai,
}: {
  readonly route: Route;
  readonly parts: ViewParts;
  readonly ai: AiChoice;
}) {
  const center = parts.page.snapshot?.center ?? null;
  const where = whereIs(route, center?.id ?? null);
  const foreign = route.view === 'channel' && where?.place.id !== 'my-channel';
  return (
    <>
      {where && !foreign && <PlaceHeader where={where} channelTitle={center?.title ?? null} />}
      {drawView(route, parts, ai)}
    </>
  );
}
