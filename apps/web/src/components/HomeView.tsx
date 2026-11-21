import { Card } from './layout/Card';
import { SplitView, ViewPage } from './layout/SplitView';
import { ViewHeader } from './layout/ViewHeader';
import { MapToolbar } from './MapToolbar';
import { NextStepCard } from './NextStepCard';
import { SavedChannels } from './SavedChannels';
import { downloadMap } from './useMapPage';
import type { ViewParts } from './viewParts';

/** Before any map: what to do first, in one line. */
function Welcome({ running }: { readonly running: boolean }) {
  return (
    <Card>
      <div role={running ? 'status' : undefined} className="flex flex-col gap-2">
        <h3 className="text-headline-md font-bold text-on-surface">
          {running ? 'Making your map' : 'Start with your channel'}
        </h3>
        <p className="text-body-md text-on-surface-variant">
          {running
            ? 'This takes a few minutes. Keep this page open.'
            : 'Paste your channel and press Find competitors.'}
        </p>
      </div>
    </Card>
  );
}

/**
 * Home: the next step for the channel on screen, your channels, and the
 * search for competitors at the side. The channel's numbers are on its own
 * page, under Channel.
 */
export function HomeView({ page, work, path, openChannel }: ViewParts) {
  const { snapshot } = page;
  const running = page.job?.status === 'running';
  return (
    <ViewPage labelledBy="home-title">
      <ViewHeader
        titleId="home-title"
        title="Home"
        lead="Pick a channel, then take the next step."
      />
      <SplitView
        sideLabel="Find competitors"
        width="narrow"
        mainFirst
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
        {snapshot ? (
          <NextStepCard
            counts={path.flow.counts}
            problem={path.flow.problem}
            centerTitle={snapshot.center.title}
          />
        ) : (
          <Welcome running={running} />
        )}
        <SavedChannels
          channels={page.saved}
          currentId={snapshot?.center.id ?? null}
          busy={running}
          onOpen={(channel) => {
            page.open(channel);
            openChannel(channel.id);
          }}
          onDelete={(channel) => void page.remove(channel)}
          badges={work.alertCounts.counts}
        />
      </SplitView>
    </ViewPage>
  );
}
