import { Fragment, type ReactNode } from 'react';

interface Props {
  /** Short readings, such as "812 words" or "~5:24 at 150 a minute". */
  readonly items: readonly ReactNode[];
  readonly label: string;
}

/** A slim bar fixed to the bottom of the view, with a few readings separated by bars. */
export function StatusBar({ items, label }: Props) {
  return (
    <div
      role="status"
      aria-label={label}
      className="sticky bottom-0 z-30 -mx-gutter flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-border-subtle bg-space-canvas/95 px-gutter py-2 sm:-mx-gutter-desktop sm:px-gutter-desktop text-body-sm text-on-surface-variant backdrop-blur-md"
    >
      {items.map((item, index) => (
        <Fragment key={index}>
          {index > 0 && (
            <span aria-hidden="true" className="text-outline-variant">
              |
            </span>
          )}
          <span className="min-w-0">{item}</span>
        </Fragment>
      ))}
    </div>
  );
}
