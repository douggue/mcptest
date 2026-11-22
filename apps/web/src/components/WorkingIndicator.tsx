import { CircleCheck, LoaderCircle, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { askedFor, doneLine, elapsedText, jobHref, runningJobs, type JobEntry } from '../lib/jobs';
import type { ViewId } from '../lib/routes';
import { useJobWatch } from './useJobWatch';

const CHIP =
  'flex min-h-11 flex-none items-center gap-2 rounded-full border border-border-subtle bg-surface-card px-3 text-body-sm text-on-surface transition-colors hover:border-border-highlight focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary-container';
const LINK = 'flex-none text-primary underline-offset-2 hover:underline';

function RunningRow({ job, now }: { readonly job: JobEntry; readonly now: number }) {
  const href = jobHref(job);
  return (
    <li className="flex min-w-0 flex-col gap-0.5">
      <span className="flex min-w-0 items-baseline justify-between gap-space-sm">
        <span className="min-w-0 break-words text-on-surface">{job.title}</span>
        {href && (
          <a href={href} className={LINK}>
            Open
          </a>
        )}
      </span>
      <span className="text-label text-outline">
        {job.progress ?? 'Working'} · {elapsedText(job, now)}
      </span>
    </li>
  );
}

interface NoticeProps {
  readonly job: JobEntry;
  readonly onDismiss: (id: string) => void;
}

function NoticeRow({ job, onDismiss }: NoticeProps) {
  const href = jobHref(job);
  const tone = job.status === 'done' ? 'text-on-surface-variant' : 'text-error';
  return (
    <li className="flex min-w-0 items-baseline gap-space-sm">
      <span className={`min-w-0 flex-1 break-words ${tone}`}>{doneLine(job)}</span>
      {href && (
        <a href={href} className={LINK} onClick={() => onDismiss(job.id)}>
          Open
        </a>
      )}
      <button
        type="button"
        aria-label={`Dismiss: ${job.title}`}
        onClick={() => onDismiss(job.id)}
        className="flex h-6 w-6 flex-none items-center justify-center rounded text-outline hover:text-on-surface"
      >
        <X aria-hidden="true" className="h-3.5 w-3.5" />
      </button>
    </li>
  );
}

/** Closes the list on a press outside it or on Escape. */
function useCloseOutside(open: boolean, close: () => void) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return undefined;
    const outside = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) close();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open, close]);
  return box;
}

/**
 * The top bar's word on the work the local server is doing: how many runs
 * are under way, and on a press a short list of them with how far each has
 * got and a link to its view. A run that ended while the owner was on
 * another view leaves a quiet "Done" line. Shows nothing when all is quiet.
 */
export function WorkingIndicator({ active }: { readonly active: ViewId }) {
  const { jobs, watch, dismiss } = useJobWatch(active);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const box = useCloseOutside(open, close);
  useEffect(() => setOpen(false), [active]);
  const running = runningJobs(askedFor(jobs));
  const notices = askedFor(watch.notices);
  if (running.length === 0 && notices.length === 0) return null;

  const now = Date.now();
  const label = running.length > 0 ? `Working (${running.length})` : `Done (${notices.length})`;
  return (
    <div ref={box} className="relative flex-none">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="working-list"
        aria-label={`${label}: show the work under way`}
        onClick={() => setOpen(!open)}
        className={CHIP}
      >
        {running.length > 0 ? (
          <LoaderCircle
            aria-hidden="true"
            className="h-4 w-4 flex-none animate-spin text-primary motion-reduce:animate-none"
          />
        ) : (
          <CircleCheck aria-hidden="true" className="h-4 w-4 flex-none text-primary" />
        )}
        <span className="hidden sm:inline">{running.length > 0 ? 'Working' : 'Done'}</span>
        <span className="font-semibold tabular-nums">
          {running.length > 0 ? running.length : notices.length}
        </span>
      </button>
      {open && (
        <div
          id="working-list"
          className="fixed inset-x-4 top-16 z-50 mt-1 rounded border border-border-subtle bg-surface-card p-space-md text-body-sm shadow-2xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-80"
        >
          {running.length > 0 ? (
            <ul className="flex flex-col gap-space-sm">
              {running.map((job) => (
                <RunningRow key={job.id} job={job} now={now} />
              ))}
            </ul>
          ) : (
            <p className="text-on-surface-variant">Nothing is running now.</p>
          )}
          {notices.length > 0 && (
            <ul className="mt-space-sm flex flex-col gap-1.5 border-t border-border-subtle pt-space-sm">
              {notices.map((job) => (
                <NoticeRow key={job.id} job={job} onDismiss={dismiss} />
              ))}
            </ul>
          )}
          <p className="mt-space-sm text-label text-outline">
            Runs go on while you use other views or close this tab.
          </p>
        </div>
      )}
    </div>
  );
}
