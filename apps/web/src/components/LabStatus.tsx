import type { LabJobState, LabTask } from './useLabJob';

export const NOTE = 'rounded bg-surface-card p-space-lg text-body-md text-on-surface-variant';
export const PRIMARY_BUTTON =
  'rounded-full bg-on-surface px-4 py-1.5 text-body-sm font-semibold text-space-deep transition-all hover:bg-white disabled:cursor-not-allowed disabled:opacity-60';
export const QUIET_BUTTON =
  'rounded-full bg-surface-container-high px-3 py-1.5 text-body-sm font-semibold text-on-surface transition-colors hover:bg-surface-container-highest disabled:cursor-not-allowed disabled:opacity-60';
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
