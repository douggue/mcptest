import type { ReactNode } from 'react';

interface Props {
  readonly children: ReactNode;
  /** The card's one title. */
  readonly title?: ReactNode;
  /** One link or note at the top right. */
  readonly aside?: ReactNode;
  /** The screen's next step: a cyan edge and glow. One per screen. */
  readonly glow?: boolean;
  /** Something went wrong inside: a red edge. */
  readonly problem?: boolean;
  readonly as?: 'div' | 'section' | 'article' | 'li';
  readonly id?: string;
  readonly label?: string;
  readonly className?: string;
}

const EDGE = {
  plain: 'border-line',
  glow: 'border-signal/30 shadow-[0_0_0_1px_rgba(0,210,255,0.06),0_24px_60px_-30px_rgba(0,210,255,0.35)]',
  problem: 'border-bad/40',
} as const;

/**
 * The one kind of card: 16px corners, 24px inside (16 on a phone), one
 * title, rows inside, one link at the top right. Never a card inside a card.
 */
export function Card(props: Props) {
  const { children, title, aside, glow, problem, as: Tag = 'div', id, label, className } = props;
  const edge = EDGE[problem ? 'problem' : glow ? 'glow' : 'plain'];
  return (
    <Tag
      id={id}
      aria-label={label}
      className={`min-w-0 rounded-lg border bg-gradient-to-b from-card-2/90 to-card/90 p-4 sm:p-6 ${edge} ${className ?? ''}`}
    >
      {(title !== undefined || aside !== undefined) && (
        <div className="mb-3.5 flex min-w-0 items-center gap-3">
          {title !== undefined && <h2 className="min-w-0 text-headline-md text-ink">{title}</h2>}
          {aside !== undefined && (
            <div className="ml-auto flex flex-none items-center gap-1.5 text-body-sm font-medium text-link">
              {aside}
            </div>
          )}
        </div>
      )}
      {children}
    </Tag>
  );
}
