import { useEffect, useRef } from 'react';
import type { ViewId } from '../../lib/routes';
import { tabHref, type Destination } from '../../lib/sections';

interface Props {
  readonly destination: Destination;
  /** The view on screen, marked. */
  readonly active: ViewId;
  readonly centerId: string | null;
}

/** A soft fade at the right edge on narrow screens, which says the row goes on. */
const EDGE_FADE =
  '[mask-image:linear-gradient(to_right,black_85%,transparent)] md:[mask-image:none]';

/**
 * The tabs of a destination, above its view: one row that scrolls sideways
 * on its own on a phone, so the page never does. The tab on screen is
 * brought into view, and a fade at the edge says there are more.
 */
export function SectionTabs({ destination, active, centerId }: Props) {
  const current = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    const tab = current.current;
    const row = tab?.parentElement;
    if (!tab || !row) return;
    // Scroll the row only, never the page.
    row.scrollLeft = tab.offsetLeft - (row.clientWidth - tab.offsetWidth) / 2;
  }, [active]);

  if (destination.tabs.length === 0) return null;
  return (
    <div className="mx-auto w-full max-w-[1440px] px-gutter pt-space-md sm:px-gutter-desktop">
      <nav
        aria-label={`${destination.label} tabs`}
        className={`relative -mx-1 flex min-w-0 gap-1 overflow-x-auto border-b border-border-subtle px-1 pr-8 md:pr-1 ${EDGE_FADE}`}
      >
        {destination.tabs.map((tab) => {
          const isActive = tab.view === active;
          return (
            <a
              key={tab.view}
              ref={isActive ? current : undefined}
              href={tabHref(tab.view, centerId)}
              aria-current={isActive ? 'page' : undefined}
              className={`-mb-px flex min-h-11 flex-none items-center whitespace-nowrap border-b-2 px-3 text-body-md transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary-container ${
                isActive
                  ? 'border-primary-container font-semibold text-on-surface'
                  : 'border-transparent text-on-surface-variant hover:text-on-surface'
              }`}
            >
              {tab.label}
            </a>
          );
        })}
      </nav>
    </div>
  );
}
