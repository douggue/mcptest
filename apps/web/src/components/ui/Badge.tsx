import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

/** A breakout score, such as 269×: the only thing drawn in amber. */
export function ScoreBadge({
  children,
  onThumb,
}: {
  readonly children: ReactNode;
  /** Over a thumbnail, on a dark backing so it reads on any picture. */
  readonly onThumb?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-score/35 px-[9px] py-[3px] text-metric-badge text-score ${onThumb ? 'bg-ground/85' : 'bg-score/[0.12]'}`}
    >
      {children}
    </span>
  );
}

/**
 * `ok` is done or earning; `proven` is counted across videos; `estimate` is
 * a guess and is always dashed; `warn` asks for a look; `plain` only says.
 */
export type BadgeTone = 'plain' | 'ok' | 'proven' | 'estimate' | 'warn';

const TONE: Readonly<Record<BadgeTone, string>> = {
  plain: 'border-line-2 text-muted',
  ok: 'border-good/35 bg-good/[0.08] text-good',
  proven: 'border-link/40 bg-link/[0.08] text-link',
  estimate: 'border-dashed border-line-2 text-muted',
  warn: 'border-score/35 text-score',
};

interface BadgeProps {
  readonly children: ReactNode;
  readonly tone?: BadgeTone;
  readonly icon?: LucideIcon;
}

/** A small pill that states one fact about the thing beside it. */
export function Badge({ children, tone = 'plain', icon: Icon }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[13px] font-medium leading-4 ${TONE[tone]}`}
    >
      {Icon && <Icon aria-hidden="true" className="h-3.5 w-3.5 flex-none" />}
      {children}
    </span>
  );
}

export type Closeness = 'close' | 'medium' | 'far';

const LEVEL: Readonly<Record<Closeness, { readonly label: string; readonly tone: string }>> = {
  close: { label: 'Close', tone: 'text-signal' },
  medium: { label: 'Medium', tone: 'text-mid' },
  far: { label: 'Far', tone: 'text-dim' },
};

/** How close a channel sits to the owner's: a dot and one word. */
export function Level({ level }: { readonly level: Closeness }) {
  const { label, tone } = LEVEL[level];
  return (
    <span className={`inline-flex items-center gap-1.5 text-body-sm font-semibold ${tone}`}>
      <span aria-hidden="true" className="h-[7px] w-[7px] rounded-full bg-current" />
      {label}
    </span>
  );
}
