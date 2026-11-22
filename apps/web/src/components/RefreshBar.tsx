import { History, RefreshCw } from 'lucide-react';
import {
  describeOutcome,
  describeProgress,
  describeRefresh,
  describeSchedule,
  refreshLine,
} from '../lib/refresh';
import { Details } from './layout/Details';
import { PRIMARY_BUTTON } from './LabStatus';
import type { Refresh, RefreshRun } from './useRefresh';

const NOTE = 'text-body-sm text-on-surface-variant';

/** What the refresh started from this page is doing, or how it ended. */
function Outcome({ run }: { readonly run: RefreshRun }) {
  if (run.status === 'running') {
    return (
      <p role="status" className={`flex items-center gap-2 ${NOTE}`}>
        <span className="h-2 w-2 flex-none animate-pulse rounded-full bg-primary-container shadow-[0_0_8px_#00d2ff]" />
        {describeProgress(run.progress)}. This takes a few minutes; you can keep using the page.
      </p>
    );
  }
  if (run.status === 'done') {
    return (
      <p role="status" className={NOTE}>
        {describeOutcome(run.summary)}
      </p>
    );
  }
  if (run.status === 'failed') {
    return (
      <p role="alert" className="text-body-sm text-error">
        {run.message}
      </p>
    );
  }
  return null;
}

/**
 * A quiet card: when the stored channels were last read again, a button that
 * does it now, and, behind a disclosure, how to have a timer do it.
 */
export function RefreshBar({ refresh }: { readonly refresh: Refresh }) {
  const { view, run, start } = refresh;
  // Nothing to say until the status is in, and nothing to refresh on an empty store.
  if (view.status === 'loading') return null;
  if (view.status === 'ready' && view.reply.channels === 0) return null;
  const running = run.status === 'running';

  return (
    <section
      aria-labelledby="refresh-title"
      className="flex min-w-0 flex-col gap-1 rounded-lg border border-border-subtle bg-surface-card px-space-md py-space-sm"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-space-md gap-y-1">
        <h3 id="refresh-title" className="sr-only">
          Refresh
        </h3>
        <History aria-hidden="true" className="h-4 w-4 flex-none text-outline" />
        <p className="min-w-0 flex-1 basis-56 text-body-sm text-on-surface-variant">
          {view.status === 'ready' ? refreshLine(view.reply, new Date()) : ''}
        </p>
        <button
          type="button"
          onClick={start}
          disabled={running}
          className={`flex flex-none items-center gap-1.5 ${PRIMARY_BUTTON}`}
        >
          <RefreshCw aria-hidden="true" className={`h-4 w-4 ${running ? 'animate-spin' : ''}`} />
          {running ? 'Refreshing…' : 'Refresh now'}
        </button>
      </div>
      {view.status === 'failed' ? (
        <p role="alert" className="text-body-sm text-error">
          The refresh status could not be loaded: {view.message}
        </p>
      ) : (
        <Details summary="More about refreshing">
          <p className={NOTE}>{describeRefresh(view.reply, new Date())}</p>
          <p className={NOTE}>{describeSchedule(view.reply.everyHours)}</p>
        </Details>
      )}
      <Outcome run={run} />
    </section>
  );
}
