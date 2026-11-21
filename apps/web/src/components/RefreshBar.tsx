import { History, RefreshCw } from 'lucide-react';
import {
  describeOutcome,
  describeProgress,
  describeRefresh,
  describeSchedule,
} from '../lib/refresh';
import { Card, Label } from './layout/Card';
import { Details } from './layout/Details';
import { QUIET_BUTTON } from './LabStatus';
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
    <section aria-labelledby="refresh-title" className="min-w-0">
      <Card>
        <Label
          action={
            <button
              type="button"
              onClick={start}
              disabled={running}
              className={`flex flex-none items-center gap-1.5 ${QUIET_BUTTON}`}
            >
              <RefreshCw
                aria-hidden="true"
                className={`h-4 w-4 ${running ? 'animate-spin' : ''}`}
              />
              {running ? 'Refreshing…' : 'Refresh now'}
            </button>
          }
        >
          <span id="refresh-title" className="flex items-center gap-1.5">
            <History aria-hidden="true" className="h-4 w-4" />
            Refresh
          </span>
        </Label>
        {view.status === 'failed' ? (
          <p role="alert" className="text-body-sm text-error">
            The refresh status could not be loaded: {view.message}
          </p>
        ) : (
          <>
            <p className={NOTE}>{describeRefresh(view.reply, new Date())}</p>
            <Details summary="Refresh by itself">
              <p className={NOTE}>{describeSchedule(view.reply.everyHours)}</p>
            </Details>
          </>
        )}
        <Outcome run={run} />
      </Card>
    </section>
  );
}
