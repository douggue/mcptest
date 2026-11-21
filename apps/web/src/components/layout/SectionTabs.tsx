import type { ViewId } from '../../lib/routes';
import { tabHref, type Destination } from '../../lib/sections';

interface Props {
  readonly destination: Destination;
  /** The view on screen, marked. */
  readonly active: ViewId;
  readonly centerId: string | null;
}

/**
 * The tabs of a destination, above its view: one row that scrolls sideways
 * on its own on a phone, so the page never does.
 */
export function SectionTabs({ destination, active, centerId }: Props) {
  if (destination.tabs.length === 0) return null;
  return (
    <div className="mx-auto w-full max-w-[1440px] px-gutter pt-space-md sm:px-gutter-desktop">
      <nav
        aria-label={`${destination.label} tabs`}
        className="-mx-1 flex min-w-0 gap-1 overflow-x-auto border-b border-border-subtle px-1"
      >
        {destination.tabs.map((tab) => {
          const current = tab.view === active;
          return (
            <a
              key={tab.view}
              href={tabHref(tab.view, centerId)}
              aria-current={current ? 'page' : undefined}
              className={`-mb-px flex min-h-11 flex-none items-center whitespace-nowrap border-b-2 px-3 text-body-md transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary-container ${
                current
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
