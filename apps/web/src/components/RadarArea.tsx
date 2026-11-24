import { describeLogoRun } from '../lib/logos';
import { describeMix } from '../lib/mix';
import { Details } from './layout/Details';
import { ViewPage } from './layout/SplitView';
import { ViewHeader } from './layout/ViewHeader';
import { Radar, RadarLegend } from './Radar';
import { ScopeToggle } from './ScopeToggle';
import type { MapPage } from './useMapPage';

interface Props {
  readonly page: MapPage;
  /** Opens one channel's own view. */
  readonly onOpenChannel: (channelId: string) => void;
}

/** Said over the empty rings: the map is being made, or how to make one. */
function EmptyRadar({ running }: { readonly running: boolean }) {
  return (
    <div
      role={running ? 'status' : undefined}
      className="max-w-md rounded-lg border border-border-subtle bg-space-canvas/85 p-space-lg backdrop-blur-md"
    >
      <h3 className="text-headline-md font-bold text-on-surface">
        {running ? 'Making your map' : 'Map who you compete with'}
      </h3>
      <p className="mt-2 text-body-md text-on-surface-variant">
        {running
          ? 'The map appears here when it is done, in a few minutes. Keep this page open.'
          : 'Paste your channel on the overview and press Find competitors.'}
      </p>
    </div>
  );
}

/** Under the radar: the key, the split of the look-alikes, and what is not drawn. */
function RadarFoot({ page }: { readonly page: MapPage }) {
  const { snapshot, layout, logoRun } = page;
  const mix = snapshot ? describeMix(snapshot.channels) : null;
  const hidden = layout?.hidden ?? 0;
  return (
    <div className="flex min-w-0 flex-col gap-space-sm">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-space-lg gap-y-2">
        <RadarLegend />
        <p className="text-body-sm text-on-surface-variant">
          {[mix, hidden > 0 ? `${hidden} more not drawn` : null]
            .filter((part) => part !== null)
            .join(' · ')}
        </p>
      </div>
      {logoRun !== null && (
        <p role="status" className="text-body-sm text-outline">
          {describeLogoRun(logoRun === 'starting' ? null : logoRun)}
        </p>
      )}
      {mix && (
        <Details summary="What taken off and rising mean">
          <p className="max-w-3xl text-body-sm text-on-surface-variant">
            Channels like yours are listed about seven that have already taken off to three that are
            rising, as far as the map has them. Taken off: three or more uploads in the last 90 days
            passed 10K views, 100K views in all and at least one per subscriber. Rising: under three
            months old and already far above its size, with small totals so far.
          </p>
        </Details>
      )}
    </div>
  );
}

/** The radar: the map on screen, its scope and the logo reading. A channel on it opens its view. */
export function RadarArea({ page, onOpenChannel }: Props) {
  const { snapshot, visible, layout, job } = page;
  return (
    <ViewPage labelledBy="radar-title">
      <ViewHeader
        titleId="radar-title"
        title="Map"
        lead={
          snapshot
            ? `${snapshot.center.title} in the middle; closer rings are closer competitors. Press a channel to open it.`
            : 'Your channel in the middle, its competitors on rings around it.'
        }
        actions={
          snapshot && (
            <ScopeToggle
              scope={page.activeScope}
              onChange={(next) => {
                page.setScope(next);
              }}
              peerCount={page.peerCount}
              totalCount={snapshot.channels.length}
            />
          )
        }
      />
      <Radar
        snapshot={visible}
        layout={layout}
        selectedId={null}
        onSelect={onOpenChannel}
        emptyState={<EmptyRadar running={job?.status === 'running'} />}
      />
      {snapshot && <RadarFoot page={page} />}
    </ViewPage>
  );
}
