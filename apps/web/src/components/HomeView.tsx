import { Card } from './layout/Card';
import { ViewPage } from './layout/SplitView';
import { ViewHeader } from './layout/ViewHeader';
import { MapToolbar } from './MapToolbar';
import { NextStepCard } from './NextStepCard';
import { SavedChannels } from './SavedChannels';
import { TodayBreakouts } from './TodayBreakouts';
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
            : 'Paste your channel below and press Find competitors.'}
        </p>
      </div>
    </Card>
  );
}

/**
 * Home, in one column: the next step for the channel on screen, your
 * channels as cards, and the search that adds a channel. The channel's
 * numbers are on its own page, under Channel.
 */
export function HomeView({ page, work, path, openChannel }: ViewParts) {
  const { snapshot } = page;
  const running = page.job?.status === 'running';
  return (
    <ViewPage labelledBy="home-title">
      <div className="mx-auto flex w-full max-w-4xl min-w-0 flex-col gap-space-lg">
        <ViewHeader
          titleId="home-title"
          title="Home"
          lead="Pick a channel, then take the next step."
        />
        {snapshot ? (
          <NextStepCard
            counts={path.flow.counts}
            problem={path.flow.problem}
            centerTitle={snapshot.center.title}
          />
        ) : (
          <Welcome running={running} />
        )}
        {page.visible && page.visible.breakouts.length > 0 && (
          <TodayBreakouts breakouts={page.visible.breakouts} />
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
          breakouts={page.visible?.breakouts.length ?? null}
        />
        <section
          aria-label="Add a channel"
          className="rounded-lg border border-border-subtle bg-space-canvas p-space-md sm:p-space-lg"
        >
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
            onExport={null}
            quiet={snapshot !== null}
          />
        </section>
      </div>
    </ViewPage>
  );
}
