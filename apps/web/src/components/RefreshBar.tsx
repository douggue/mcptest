import { History, RefreshCw } from 'lucide-react';
import {
  describeOutcome,
  describeProgress,
  describeRefresh,
  describeSchedule,
} from '../lib/refresh';
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
 * A quiet strip at the foot of the page: when the stored channels were last
 * read again, whether a timer does it, and a button that does it now.
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
      className="w-full bg-space-deep px-gutter-desktop pb-space-xl"
    >
      <div className="mx-auto flex max-w-[1440px] flex-col gap-space-md rounded bg-surface-card p-space-md sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-space-sm">
          <History aria-hidden="true" className="mt-0.5 h-[18px] w-[18px] flex-none text-outline" />
          <div className="flex min-w-0 flex-col gap-1">
            <h2 id="refresh-title" className="text-label-caps uppercase text-outline">
              View history
            </h2>
            {view.status === 'failed' ? (
              <p role="alert" className="text-body-sm text-error">
                The refresh status could not be loaded: {view.message}
              </p>
            ) : (
              <>
                <p className={NOTE}>{describeRefresh(view.reply, new Date())}</p>
                <p className="text-body-sm text-outline">
                  {describeSchedule(view.reply.everyHours)}
                </p>
              </>
            )}
            <Outcome run={run} />
          </div>
        </div>
        <button
          type="button"
          onClick={start}
          disabled={running}
          className="flex flex-none items-center justify-center gap-1.5 rounded-full bg-surface-container-high px-4 py-2 text-body-sm font-semibold text-on-surface transition-colors hover:bg-surface-variant disabled:cursor-not-allowed disabled:opacity-60"
        >
          <RefreshCw aria-hidden="true" className={`h-4 w-4 ${running ? 'animate-spin' : ''}`} />
          {running ? 'Refreshing…' : 'Refresh now'}
        </button>
      </div>
    </section>
  );
}
