import type { ReactNode } from 'react';

interface Props {
  /** The controls of the view: what to make, from what, and the one button that makes it. */
  readonly side: ReactNode;
  /** What the view made or shows. */
  readonly children: ReactNode;
  /** A label for the side panel, read by screen readers. */
  readonly sideLabel: string;
  /** The side panel's width on a wide screen. */
  readonly width?: 'narrow' | 'wide';
  /** On a phone, the main area first and the side panel under it, where the result is the next step. */
  readonly mainFirst?: boolean;
}

const WIDTH = {
  narrow: 'lg:grid-cols-[340px_minmax(0,1fr)]',
  wide: 'lg:grid-cols-[360px_minmax(0,1fr)]',
} as const;

/**
 * Two columns at most: a side panel that scrolls with the page, so its button
 * is never hidden inside it, and the main area. On a phone or a narrow window the side panel
 * comes first, above the main area.
 */
export function SplitView({ side, children, sideLabel, width = 'wide', mainFirst }: Props) {
  return (
    <div className={`grid min-w-0 grid-cols-1 items-start gap-space-lg ${WIDTH[width]}`}>
      <aside
        aria-label={sideLabel}
        className={`flex min-w-0 flex-col gap-space-lg rounded-lg border border-border-subtle bg-space-canvas p-space-md ${mainFirst ? 'order-2 lg:order-none' : ''}`}
      >
        {side}
      </aside>
      <div className="flex min-w-0 flex-col gap-space-lg">{children}</div>
    </div>
  );
}

/** A view's page: the gutters and the widest a view grows. */
export function ViewPage({
  children,
  labelledBy,
  id,
}: {
  readonly children: ReactNode;
  readonly labelledBy?: string;
  readonly id?: string;
}) {
  return (
    <section
      id={id}
      aria-labelledby={labelledBy}
      className="w-full scroll-mt-16 px-4 py-space-lg sm:px-8"
    >
      <div className="mx-auto flex max-w-[1260px] min-w-0 flex-col gap-space-lg">{children}</div>
    </section>
  );
}
