import { ChevronRight } from 'lucide-react';
import { Fragment } from 'react';
import { flowSteps, type FlowCounts } from '../lib/flow';

/**
 * The path from research to a script, near the top of the page: each step
 * jumps to its section and says what is stored for the channel on screen.
 */
export function FlowStrip({ counts }: { readonly counts: FlowCounts | null }) {
  const steps = flowSteps(counts);
  return (
    <nav aria-label="From research to a script" className="w-full bg-space-deep px-gutter-desktop">
      <ol className="mx-auto flex max-w-[1440px] flex-wrap items-stretch gap-2 py-space-sm">
        {steps.map((step, index) => (
          <Fragment key={step.id}>
            {index > 0 && (
              <li aria-hidden="true" className="flex items-center text-outline">
                <ChevronRight className="h-4 w-4" />
              </li>
            )}
            <li className="min-w-0">
              <a
                href={`#${step.target}`}
                className="flex min-w-0 flex-col rounded bg-surface-card px-3 py-1.5 transition-colors hover:bg-surface-container-high focus:outline-none focus-visible:ring-1 focus-visible:ring-primary-container"
              >
                <span className="flex items-center gap-1.5 text-body-sm font-semibold text-on-surface">
                  <span
                    aria-hidden="true"
                    className={`h-1.5 w-1.5 flex-none rounded-full ${step.done ? 'bg-primary-container' : 'bg-outline-variant'}`}
                  />
                  {index + 1}. {step.label}
                </span>
                <span className="truncate text-label-caps normal-case text-outline">
                  {step.count || ' '}
                </span>
              </a>
            </li>
          </Fragment>
        ))}
      </ol>
    </nav>
  );
}
