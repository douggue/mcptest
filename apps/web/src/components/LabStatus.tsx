import type { LabJobState, LabTask } from './useLabJob';

export const NOTE =
  'rounded-lg border border-line bg-surface-card p-space-md sm:p-space-lg text-body-md text-on-surface-variant';
/** A small action that matters more than the ones beside it; the screen's one main action is cyan. */
export const PRIMARY_BUTTON =
  'rounded-md border border-line-2 bg-white/[0.12] px-3.5 py-1.5 text-body-sm font-semibold text-ink transition-colors hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-60';
export const QUIET_BUTTON =
  'rounded-md border border-line bg-white/[0.06] px-3 py-1.5 text-body-sm font-semibold text-ink transition-colors hover:border-line-2 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60';
export const PILL = 'rounded-full bg-surface-container-high px-2 py-0.5 text-label';
export const FIELD =
  'w-full min-w-0 min-h-11 rounded border border-border-subtle bg-space-deep px-3 py-2 text-body-md text-on-surface focus:outline-none focus-visible:ring-1 focus-visible:ring-primary-container disabled:opacity-60';

interface Props {
  readonly state: LabJobState;
  /** The kinds of job this part of the page speaks for. */
  readonly kinds: readonly LabTask['kind'][];
  /** What is being worked on, to say while the server has not named the step yet. */
  readonly working: string;
  /** How long it usually takes, in plain words. */
  readonly takes: string;
}

/** What a job of the idea lab is doing, or why it did not finish, for the section it belongs to. */
export function LabStatus({ state, kinds, working, takes }: Props) {
  if (state.status === 'idle' || !kinds.includes(state.task.kind)) return null;
  if (state.status === 'failed') {
    return (
      <p role="alert" className="rounded bg-surface-card p-space-lg text-body-md text-error">
        It did not finish: {state.message}
      </p>
    );
  }
  return (
    <p role="status" className={`flex items-center gap-2 ${NOTE}`}>
      <span className="h-2 w-2 flex-none animate-pulse rounded-full bg-primary-container shadow-[0_0_8px_#00d2ff]" />
      <span className="min-w-0 break-words">
        {state.text ?? working}. {takes}
      </span>
    </p>
  );
}
