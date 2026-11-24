import { Notice } from './layout/Notice';
import { SweepControls } from './SweepControls';
import type { Sweep } from './useSweep';
import { WatchlistEntries } from './WatchlistEntries';

/**
 * The watchlist: the keywords and topics Jgtube sweeps YouTube for, so new
 * niches turn up from more places than the owner's maps. One panel above the
 * list: the keywords on one side, the sweep on the other.
 */
export function NicheWatchlist({ sweep }: { readonly sweep: Sweep }) {
  const { info, problem, run } = sweep;
  return (
    <section
      aria-labelledby="watchlist-title"
      className="flex min-w-0 flex-col gap-space-md rounded-lg border border-border-subtle bg-space-canvas p-space-md"
    >
      <div className="flex min-w-0 flex-col gap-1">
        <h2 id="watchlist-title" className="text-headline-md text-on-surface">
          Watchlist
        </h2>
        <p className="text-body-sm text-on-surface-variant">
          Keywords Jgtube searches YouTube for, to find new niches beyond your maps.
        </p>
      </div>
      {problem && <Notice tone="problem">{problem}</Notice>}
      {info === null && !problem && <Notice tone="working">Reading the watchlist</Notice>}
      {info && (
        <div className="grid min-w-0 grid-cols-1 gap-space-lg lg:grid-cols-2">
          <WatchlistEntries
            keywords={info.keywords}
            suggestions={info.suggestions}
            canAdd={info.keywords.length < info.maxKeywords}
            onAdd={sweep.addKeyword}
            onChange={sweep.changeKeyword}
          />
          <SweepControls info={info} run={run} onStart={sweep.start} onSave={sweep.saveSettings} />
        </div>
      )}
    </section>
  );
}
