import { Layers, TriangleAlert, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Card } from './Card';

interface EmptyProps {
  /** What is missing, in one line. */
  readonly title: string;
  /** What to do about it, in one line. */
  readonly line?: ReactNode;
  /** The one button that fixes it. */
  readonly action?: ReactNode;
  readonly icon?: LucideIcon;
}

function Ring({ icon: Icon, problem }: { readonly icon: LucideIcon; readonly problem?: boolean }) {
  return (
    <div
      className={`mx-auto mb-3 grid h-14 w-14 place-items-center rounded-full border border-dashed ${problem ? 'border-bad/40 text-bad' : 'border-line-2 text-signal'}`}
    >
      <Icon aria-hidden="true" className="h-6 w-6" />
    </div>
  );
}

/** Nothing here yet: one line and one button. */
export function EmptyState({ title, line, action, icon = Layers }: EmptyProps) {
  return (
    <Card className="text-center">
      <div className="px-4 py-3">
        <Ring icon={icon} />
        <h3 className="text-title-md text-ink">{title}</h3>
        {line !== undefined && <p className="mt-1 text-body-md text-muted">{line}</p>}
        {action !== undefined && <div className="mt-4 flex justify-center">{action}</div>}
      </div>
    </Card>
  );
}

interface ErrorProps {
  /** What happened, in plain words. */
  readonly title: string;
  /** What is safe: what was kept, what is still shown. */
  readonly line?: ReactNode;
  /** The one way out, such as "Try again". */
  readonly action?: ReactNode;
}

/** Something failed: what happened, what is safe, one way out. */
export function ErrorState({ title, line, action }: ErrorProps) {
  return (
    <Card problem className="text-center">
      <div role="alert" className="px-4 py-3">
        <Ring icon={TriangleAlert} problem />
        <h3 className="text-title-md text-ink">{title}</h3>
        {line !== undefined && <p className="mt-1 break-words text-body-md text-muted">{line}</p>}
        {action !== undefined && <div className="mt-4 flex justify-center">{action}</div>}
      </div>
    </Card>
  );
}

/** A grey shape where a result will land. */
export function Skeleton({ className }: { readonly className: string }) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded-md bg-gradient-to-r from-white/5 via-white/10 to-white/5 motion-reduce:animate-none ${className}`}
    />
  );
}

interface LoadingProps {
  /** What is happening, such as "Writing 10 ideas". */
  readonly title: string;
  /** How long it has taken and how far it is, such as "0:48 · step 2 of 3". */
  readonly progress?: string;
  /** How much is done, 0 to 1, when the work can say. */
  readonly share?: number | null;
  /** One line under the bar: what is being read, and that the page can be left. */
  readonly line?: ReactNode;
}

/** Work under way: what is happening and how long, with grey shapes where results will land. */
export function LoadingState({ title, progress, share, line }: LoadingProps) {
  const width = share === null || share === undefined ? null : Math.min(1, Math.max(0, share));
  return (
    <Card>
      <div role="status">
        <div className="mb-3.5 flex min-w-0 items-center gap-3">
          <h3 className="min-w-0 text-title-md text-ink">{title}</h3>
          {progress && <span className="ml-auto flex-none text-body-sm text-dim">{progress}</span>}
        </div>
        {width !== null && (
          <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.08]">
            <div className="h-full rounded-full bg-signal" style={{ width: `${width * 100}%` }} />
          </div>
        )}
        {line !== undefined && <p className="mt-2.5 text-body-sm text-muted">{line}</p>}
        <div className="mt-4 flex flex-col gap-2.5">
          <Skeleton className="h-[22px] w-[70%]" />
          <Skeleton className="h-3.5 w-[92%]" />
          <Skeleton className="h-3.5 w-[60%]" />
        </div>
      </div>
    </Card>
  );
}
