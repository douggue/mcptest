import type { ReactNode } from 'react';

type Tone = 'note' | 'working' | 'problem';

interface Props {
  readonly children: ReactNode;
  /**
   * `note` says something plain, `working` says what is being done with a
   * pulsing dot, `problem` says what went wrong.
   */
  readonly tone?: Tone;
}

const BOX = 'rounded-lg border border-border-subtle bg-surface-card p-space-md text-body-md';

/** One line in a soft box: a plain note, the work under way, or a problem. */
export function Notice({ children, tone = 'note' }: Props) {
  if (tone === 'problem') {
    return (
      <p role="alert" className={`${BOX} break-words text-error`}>
        {children}
      </p>
    );
  }
  if (tone === 'working') {
    return (
      <p role="status" className={`${BOX} flex items-center gap-2 text-on-surface-variant`}>
        <span className="h-2 w-2 flex-none animate-pulse rounded-full bg-primary-container shadow-[0_0_8px_#00d2ff]" />
        <span className="min-w-0 break-words">{children}</span>
      </p>
    );
  }
  return <p className={`${BOX} break-words text-on-surface-variant`}>{children}</p>;
}

/** The button under a list that shows the next few, with how many are left. */
export function ShowMore({
  left,
  noun,
  onClick,
}: {
  readonly left: number;
  /** What is listed, such as "channels"; left out for "Show more". */
  readonly noun?: string;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="min-h-11 self-center rounded-full border border-border-subtle bg-surface-card px-5 text-body-sm font-semibold text-on-surface transition-colors hover:bg-surface-container-high"
    >
      Show more{noun ? ` ${noun}` : ''} ({left} left)
    </button>
  );
}
