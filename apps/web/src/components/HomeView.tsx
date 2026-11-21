import { ArrowRight } from 'lucide-react';
import { channelHref } from '../lib/routes';
import { ChannelSummary } from './ChannelSummary';
import { Card } from './layout/Card';
import { SplitView, ViewPage } from './layout/SplitView';
import { ViewHeader } from './layout/ViewHeader';
import { MapToolbar } from './MapToolbar';
import { RefreshBar } from './RefreshBar';
import { SavedChannels } from './SavedChannels';
import { useChannelProfile } from './useChannelProfile';
import { downloadMap } from './useMapPage';
import type { ViewParts } from './viewParts';

/** The channel the map on screen is centred on, in brief, with the way to its own view. */
function CenterSummary({
  centerId,
  reloadKey,
}: {
  readonly centerId: string;
  readonly reloadKey: string;
}) {
  const state = useChannelProfile(centerId, reloadKey);
  if (state.status !== 'ready') return null;
  return (
    <section aria-label="Your channel" className="min-w-0">
      <ChannelSummary
        profile={state.profile}
        action={
          <a
            href={channelHref(centerId)}
            className="flex min-h-10 items-center gap-1.5 rounded-full bg-surface-container-high px-4 text-body-sm font-semibold text-on-surface transition-colors hover:bg-surface-container-highest"
          >
            Open channel page
            <ArrowRight aria-hidden="true" className="h-4 w-4" />
          </a>
        }
      />
    </section>
  );
}

/** Before any map: what Jgtube does and how to start. */
function Welcome({ running }: { readonly running: boolean }) {
  return (
    <Card>
      <div role={running ? 'status' : undefined} className="flex flex-col gap-2">
        <h3 className="text-headline-md font-bold text-on-surface">
          {running ? 'Making your map' : 'Map who you compete with'}
        </h3>
        <p className="text-body-md text-on-surface-variant">
          {running
            ? 'Jgtube is reading the channels YouTube recommends. This takes a few minutes; keep this page open.'
            : 'Paste your channel and press Find competitors. A full map takes a few minutes; each feature then has its own view in the menu.'}
        </p>
      </div>
    </Card>
  );
}

/**
 * The overview: the search for competitors in the side panel, then your
 * channels, the current channel's numbers in brief, and the refresh.
 */
export function HomeView({ page, work, openChannel }: ViewParts) {
  const { snapshot } = page;
  return (
    <ViewPage labelledBy="overview-title">
      <ViewHeader
        titleId="overview-title"
        title="Overview"
        lead="Your channels, and who each one competes with."
      />
      <SplitView
        sideLabel="Find competitors"
        width="narrow"
        side={
          <MapToolbar
            query={page.query}
            onQueryChange={page.setQuery}
            model={page.model}
            onModelChange={page.setModel}
            measuredAgainst={snapshot?.model?.title ?? null}
            onSubmit={() => void page.submit()}
            job={page.job}
            message={page.message}
            depth={page.depth}
            onDepthChange={page.setDepth}
            size={page.size}
            onSizeChange={page.setSize}
            onExport={snapshot ? () => downloadMap(snapshot) : null}
          />
        }
      >
        <SavedChannels
          channels={page.saved}
          currentId={snapshot?.center.id ?? null}
          busy={page.job?.status === 'running'}
          onOpen={(channel) => {
            page.open(channel);
            openChannel(channel.id);
          }}
          onDelete={(channel) => void page.remove(channel)}
          badges={work.alertCounts.counts}
        />
        {snapshot ? (
          <CenterSummary centerId={snapshot.center.id} reloadKey={work.refresh.run.status} />
        ) : (
          <Welcome running={page.job?.status === 'running'} />
        )}
        <RefreshBar refresh={work.refresh} />
      </SplitView>
    </ViewPage>
  );
}
