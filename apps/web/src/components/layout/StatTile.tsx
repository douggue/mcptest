import type { ReactNode } from 'react';

interface Props {
  readonly label: string;
  readonly value: ReactNode;
  /** What the number rests on, in a few words. */
  readonly note?: ReactNode;
}

/** One labelled number, with what it rests on under it. */
export function StatTile({ label, value, note }: Props) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-lg border border-border-subtle bg-surface-card p-3">
      <dt className="text-label-caps uppercase text-outline">{label}</dt>
      <dd className="break-words text-headline-md font-bold text-on-surface">{value}</dd>
      {note && <dd className="text-body-sm text-on-surface-variant">{note}</dd>}
    </div>
  );
}

/** A row of stat tiles: as many to a row as fit at a readable width, two on a phone. */
export function StatGrid({ children }: { readonly children: ReactNode }) {
  return (
    <dl className="grid min-w-0 grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2">
      {children}
    </dl>
  );
}
