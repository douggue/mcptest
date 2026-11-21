import { ArrowRight } from 'lucide-react';
import { channelHref } from '../lib/routes';
import { ChannelSummary } from './ChannelSummary';
import { MapToolbar } from './MapToolbar';
import { RefreshBar } from './RefreshBar';
import { SavedChannels } from './SavedChannels';
import { useChannelProfile } from './useChannelProfile';
import { downloadMap } from './useMapPage';
import type { ViewParts } from './viewParts';

const WRAP = 'mx-auto w-full max-w-[1440px]';

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
    <section aria-label="Your channel" className="w-full px-gutter-desktop py-space-lg">
      <div className={WRAP}>
        <ChannelSummary
          profile={state.profile}
          action={
            <a
              href={channelHref(centerId)}
              className="flex items-center gap-1.5 rounded-full bg-on-surface px-4 py-1.5 text-body-sm font-semibold text-space-deep hover:bg-white"
            >
              Open channel page
              <ArrowRight aria-hidden="true" className="h-4 w-4" />
            </a>
          }
        />
      </div>
    </section>
  );
}

/** Before any map: what Jgtube does and how to start. */
function Welcome({ running }: { readonly running: boolean }) {
  return (
    <section className="w-full px-gutter-desktop py-space-xl">
      <div
        className={`${WRAP} max-w-2xl rounded bg-surface-card p-space-lg`}
        role={running ? 'status' : undefined}
      >
        <h1 className="text-headline-lg text-on-surface">
          {running ? 'Making your map' : 'Map who you compete with'}
        </h1>
        <p className="mt-2 text-body-lg text-on-surface-variant">
          {running
            ? 'Jgtube is following YouTube’s recommendations out from the channel and reading the channels it finds. This takes a few minutes; keep this page open.'
            : 'Paste your channel above and press Find competitors. Jgtube follows YouTube’s recommendations out from your videos; a full map takes a few minutes. Each feature then has its own view in the menu.'}
        </p>
      </div>
    </section>
  );
}

/**
 * The overview: which channel, the search for its competitors, your channels,
 * the current channel's numbers in brief, and the refresh.
 */
export function HomeView({ page, work, openChannel }: ViewParts) {
  const { snapshot } = page;
  return (
    <>
      <MapToolbar
        center={snapshot?.center ?? null}
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
    </>
  );
}
