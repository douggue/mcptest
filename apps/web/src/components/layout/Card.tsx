import type { ReactNode } from 'react';

interface Props {
  readonly children: ReactNode;
  /** Marks a card the owner kept or chose. */
  readonly highlighted?: boolean;
  readonly id?: string;
  readonly as?: 'div' | 'article' | 'section' | 'li';
  readonly className?: string;
  readonly label?: string;
  /** A row in a list: tighter padding and gaps. */
  readonly compact?: boolean;
}

/** A roomy card: one thing, with space around what it holds. */
export function Card(props: Props) {
  const { children, highlighted, id, as: Tag = 'div', className, label, compact } = props;
  return (
    <Tag
      id={id}
      aria-label={label}
      className={`flex min-w-0 scroll-mt-20 flex-col rounded-lg border bg-surface-card ${
        compact ? 'gap-space-sm px-space-md py-space-sm' : 'gap-space-md p-space-md sm:p-space-lg'
      } ${highlighted ? 'border-border-highlight' : 'border-border-subtle'} ${className ?? ''}`}
    >
      {children}
    </Tag>
  );
}

/** A small heading in capitals inside a card or a side panel, with an optional action at the right. */
export function Label({
  children,
  action,
}: {
  readonly children: ReactNode;
  readonly action?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-2">
      <span className="text-label text-outline">{children}</span>
      {action}
    </div>
  );
}

/** A labelled part of a side panel or a card. */
export function Field({
  label,
  action,
  children,
}: {
  readonly label: ReactNode;
  readonly action?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <Label action={action}>{label}</Label>
      {children}
    </div>
  );
}
