import type { ReactNode } from 'react';

/**
 * A few stat tiles inside a card or a narrow main area: they share the width
 * equally, and wrap when a tile would grow too narrow to read.
 */
export function StatRow({ children }: { readonly children: ReactNode }) {
  return (
    <dl className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(6.25rem,1fr))] gap-2">
      {children}
    </dl>
  );
}
