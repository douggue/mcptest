import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';

interface Props {
  /** What is behind it, in a few words, such as "Details" or "Alternate titles (2)". */
  readonly summary: ReactNode;
  readonly children: ReactNode;
  /** Open at first; leave out, so the view stays calm. */
  readonly open?: boolean;
}

/** What most people need only sometimes, behind a disclosure that starts closed. */
export function Details({ summary, children, open }: Props) {
  return (
    <details open={open} className="group/details min-w-0">
      <summary className="flex w-fit cursor-pointer list-none items-center gap-1.5 rounded text-body-sm text-primary focus:outline-none focus-visible:ring-1 focus-visible:ring-primary-container [&::-webkit-details-marker]:hidden">
        <ChevronRight
          aria-hidden="true"
          className="h-4 w-4 transition-transform group-open/details:rotate-90"
        />
        {summary}
      </summary>
      <div className="mt-space-sm flex min-w-0 flex-col gap-space-md">{children}</div>
    </details>
  );
}
