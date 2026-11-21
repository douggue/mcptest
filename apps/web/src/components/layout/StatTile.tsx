import type { ReactNode } from 'react';

interface Props {
  readonly label: string;
  readonly value: ReactNode;
  /** What the number rests on, in a few words. */
  readonly note?: ReactNode;
  /** A longer reading, shown when the tile is pointed at. */
  readonly detail?: string;
}

/** One labelled number, with what it rests on under it. */
export function StatTile({ label, value, note, detail }: Props) {
  return (
    <div
      title={detail}
      className="flex min-w-0 flex-col gap-1 rounded-[0.75rem] border border-border-subtle bg-surface-card px-4 py-3"
    >
      <dt className="truncate text-label-caps uppercase text-outline">{label}</dt>
      <dd className="truncate text-headline-md font-bold tabular-nums text-on-surface">{value}</dd>
      {note && <dd className="line-clamp-2 text-xs text-outline">{note}</dd>}
    </div>
  );
}

/** A row of stat tiles: as many to a row as fit at a readable width, two on a phone. */
export function StatGrid({ children }: { readonly children: ReactNode }) {
  return (
    <dl className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-2">
      {children}
    </dl>
  );
}
