import { describeLogoRun } from '../lib/logos';
import { describeMix } from '../lib/mix';
import { Inspector } from './Inspector';
import { Radar } from './Radar';
import { ScopeToggle } from './ScopeToggle';
import { messageOf, type MapPage } from './useMapPage';

interface Props {
  readonly page: MapPage;
  /** An AI run is under way somewhere on the page. */
  readonly busy: boolean;
  readonly onBreakDown: (channel: { readonly id: string; readonly title: string }) => void;
}

/** The radar: the map on screen, its scope, the logo reading and the channel picked on it. */
export function RadarArea({ page, busy, onBreakDown }: Props) {
  const { snapshot, visible, layout, selectedId, select, job, logoRun } = page;
  const selected = snapshot?.channels.find((channel) => channel.id === selectedId) ?? null;
  return (
    <Radar
      snapshot={visible}
      layout={layout}
      selectedId={selectedId}
      onSelect={select}
      emptyState={
        <div className="max-w-md rounded bg-space-canvas/80 p-space-lg backdrop-blur-md">
          {job?.status === 'running' ? (
            <div role="status">
              <h1 className="text-headline-lg text-on-surface">Making your map</h1>
              <p className="mt-2 text-body-lg text-on-surface-variant">
                Jgtube is following YouTube&rsquo;s recommendations out from the channel and reading
                the channels it finds. This takes a few minutes; the map appears here when it is
                done. Keep this page open.
              </p>
            </div>
          ) : (
            <>
              <h1 className="text-headline-lg text-on-surface">Map who you compete with</h1>
              <p className="mt-2 text-body-lg text-on-surface-variant">
                Paste your channel above and press Find competitors. Jgtube follows YouTube&rsquo;s
                recommendations out from your videos; a full map takes a few minutes.
              </p>
            </>
          )}
        </div>
      }
    >
      {snapshot && (
        <ScopeToggle
          scope={page.activeScope}
          onChange={(next) => {
            page.setScope(next);
            page.setSelectedId(null);
          }}
          peerCount={page.peerCount}
          totalCount={snapshot.channels.length}
          mix={describeMix(snapshot.channels)}
        />
      )}
      {logoRun !== null && (
        <p
          role="status"
          className="absolute bottom-5 right-6 z-40 rounded-full bg-surface-card/90 px-3 py-1.5 text-label-caps text-on-surface-variant shadow-lg backdrop-blur-md"
        >
          {describeLogoRun(logoRun === 'starting' ? null : logoRun)}
        </p>
      )}
      {selected && snapshot && (
        <Inspector
          channel={selected}
          onClose={() => page.setSelectedId(null)}
          onSetStatus={(status) => {
            page
              .setStatus(selected.id, status)
              .catch((error: unknown) => page.setMessage(messageOf(error)));
          }}
          busy={busy}
          onBreakDown={() => onBreakDown(selected)}
        />
      )}
    </Radar>
  );
}
