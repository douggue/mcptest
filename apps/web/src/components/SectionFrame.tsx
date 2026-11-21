import { ChevronDown, Info, type LucideIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';

interface Props {
  /** The section's id, which in-page links and the view's address point to. */
  readonly id: string;
  readonly titleId: string;
  readonly title: string;
  readonly icon: LucideIcon;
  /** One short line under the title. */
  readonly lead: ReactNode;
  /** The longer explanation, behind a "How this works" disclosure. */
  readonly howItWorks?: ReactNode;
  /** The section's one primary action, and any quiet ones beside it. */
  readonly actions?: ReactNode;
  /** A few words shown beside the title, such as a count. */
  readonly summary?: string;
  readonly children: ReactNode;
}

/**
 * The frame every working section shares: a title that opens and closes the
 * section (each opens open, as it has a view of its own), one short line, the longer
 * explanation behind a disclosure, the primary action, then the section.
 */
export function SectionFrame(props: Props) {
  const { id, titleId, title, icon: Icon, lead, howItWorks, actions, summary, children } = props;
  const [closed, setClosed] = useState(false);
  const toggle = (): void => setClosed(!closed);
  return (
    <section
      id={id}
      aria-labelledby={titleId}
      className="w-full scroll-mt-16 bg-space-deep px-gutter-desktop pb-space-xl"
    >
      <div className="mx-auto flex max-w-[1440px] flex-col gap-space-lg border-t border-border-subtle pt-space-lg">
        <div className="flex min-w-0 flex-col gap-2">
          <h2 id={titleId} className="min-w-0">
            <button
              type="button"
              aria-expanded={!closed}
              aria-controls={`${id}-body`}
              onClick={toggle}
              className="group flex min-w-0 items-center gap-2 rounded text-left focus:outline-none focus-visible:ring-1 focus-visible:ring-primary-container"
            >
              <Icon aria-hidden="true" className="h-[22px] w-[22px] flex-none text-metric-amber" />
              <span className="text-headline-lg font-bold tracking-tight text-on-surface">
                {title}
              </span>
              {summary && (
                <span className="rounded-full bg-surface-container-high px-2 py-0.5 text-label text-on-surface-variant">
                  {summary}
                </span>
              )}
              <ChevronDown
                aria-hidden="true"
                className={`h-5 w-5 flex-none text-outline transition-transform ${closed ? '-rotate-90' : ''}`}
              />
              <span className="sr-only">{closed ? 'Open this section' : 'Close this section'}</span>
            </button>
          </h2>
          {!closed && <div className="text-body-md text-on-surface-variant">{lead}</div>}
          {!closed && howItWorks && (
            <details className="group/how min-w-0">
              <summary className="flex w-fit cursor-pointer list-none items-center gap-1.5 rounded text-body-sm text-primary focus:outline-none focus-visible:ring-1 focus-visible:ring-primary-container [&::-webkit-details-marker]:hidden">
                <Info aria-hidden="true" className="h-4 w-4" />
                How this works
              </summary>
              <div className="mt-2 flex max-w-3xl flex-col gap-2 text-body-sm text-on-surface-variant">
                {howItWorks}
              </div>
            </details>
          )}
          {!closed && actions && (
            <div className="flex min-w-0 flex-wrap items-center gap-2 pt-1">{actions}</div>
          )}
        </div>
        <div id={`${id}-body`} hidden={closed} className="flex min-w-0 flex-col gap-space-lg">
          {!closed && children}
        </div>
      </div>
    </section>
  );
}
