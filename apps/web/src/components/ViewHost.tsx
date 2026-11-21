import type { ReactNode } from 'react';
import type { AiChoice } from './AiEngines';
import type { Route, ViewId } from '../lib/routes';
import { destinationOf } from '../lib/sections';
import { ChannelView } from './ChannelView';
import { CREATE_VIEWS } from './CreateViews';
import { HomeView } from './HomeView';
import { SectionTabs } from './layout/SectionTabs';
import { RESEARCH_VIEWS } from './ResearchViews';
import { Settings } from './Settings';
import { STUDY_VIEWS } from './StudyViews';
import type { ViewDraw, ViewParts } from './viewParts';

const VIEW_DRAWS: Partial<Record<ViewId, ViewDraw>> = {
  ...RESEARCH_VIEWS,
  ...CREATE_VIEWS,
  ...STUDY_VIEWS,
};

/** The tabs of the view's destination; none on a competitor's page, which has its back arrow. */
function Tabs({ route, centerId }: { readonly route: Route; readonly centerId: string | null }) {
  const destination = destinationOf(route.view);
  if (!destination) return null;
  if (route.view === 'channel' && route.channelId !== centerId) return null;
  return <SectionTabs destination={destination} active={route.view} centerId={centerId} />;
}

function drawView(route: Route, parts: ViewParts, ai: AiChoice): ReactNode {
  if (route.view === 'channel' && route.channelId) {
    return <ChannelView key={route.channelId} {...parts} channelId={route.channelId} />;
  }
  if (route.view === 'settings') return <Settings ai={ai} />;
  const draw = VIEW_DRAWS[route.view];
  return draw ? draw(parts) : <HomeView {...parts} />;
}

/** The one view the address names, under its destination's tabs; nothing else is drawn. */
export function ViewHost({
  route,
  parts,
  ai,
}: {
  readonly route: Route;
  readonly parts: ViewParts;
  readonly ai: AiChoice;
}) {
  const centerId = parts.page.snapshot?.center.id ?? null;
  return (
    <>
      <Tabs route={route} centerId={centerId} />
      {drawView(route, parts, ai)}
    </>
  );
}
