import type { ReactNode } from 'react';
import type { AiChoice } from './AiEngines';
import type { Route, ViewId } from '../lib/routes';
import { ChannelView } from './ChannelView';
import { CREATE_VIEWS } from './CreateViews';
import { FlowStrip } from './FlowStrip';
import { HomeView } from './HomeView';
import { RESEARCH_VIEWS } from './ResearchViews';
import { Settings } from './Settings';
import { STUDY_VIEWS } from './StudyViews';
import type { ViewDraw, ViewParts } from './viewParts';

const VIEW_DRAWS: Partial<Record<ViewId, ViewDraw>> = {
  ...RESEARCH_VIEWS,
  ...CREATE_VIEWS,
  ...STUDY_VIEWS,
};

/** The views on the path from research to a script, which show the strip of its steps. */
const FLOW_VIEWS: ReadonlySet<ViewId> = new Set<ViewId>([
  'home',
  'breakouts',
  'formats',
  'hooks',
  'ideas',
  'script',
  'ask',
]);

function Flow({ parts, view }: { readonly parts: ViewParts; readonly view: ViewId }) {
  const { flow } = parts.path;
  if (!parts.page.snapshot || !FLOW_VIEWS.has(view)) return null;
  return (
    <div className="pt-space-sm">
      <FlowStrip counts={flow.counts} active={view} />
      {flow.problem && (
        <p
          role="alert"
          className="mx-auto w-full max-w-[1440px] px-gutter-desktop text-body-md text-error"
        >
          {flow.problem}
        </p>
      )}
    </div>
  );
}

function drawView(route: Route, parts: ViewParts, ai: AiChoice): ReactNode {
  if (route.view === 'channel' && route.channelId) {
    return <ChannelView key={route.channelId} {...parts} channelId={route.channelId} />;
  }
  if (route.view === 'settings') return <Settings ai={ai} />;
  const draw = VIEW_DRAWS[route.view];
  return draw ? draw(parts) : <HomeView {...parts} />;
}

/** The one view the address names; nothing else is drawn. */
export function ViewHost({
  route,
  parts,
  ai,
}: {
  readonly route: Route;
  readonly parts: ViewParts;
  readonly ai: AiChoice;
}) {
  return (
    <>
      {route.view !== 'home' && <Flow parts={parts} view={route.view} />}
      {drawView(route, parts, ai)}
      {route.view === 'home' && <Flow parts={parts} view="home" />}
      <p className="mx-auto w-full max-w-[1440px] px-gutter-desktop py-space-xl text-label-caps text-outline">
        Jgtube reads YouTube&rsquo;s public pages without an account. That is outside
        YouTube&rsquo;s terms of service and can stop working without notice. Scores and earnings
        are estimates.
      </p>
    </>
  );
}
