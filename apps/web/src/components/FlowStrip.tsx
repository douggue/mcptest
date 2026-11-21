import { flowSteps, type FlowCounts } from '../lib/flow';
import { routeHash, type ViewId } from '../lib/routes';

/**
 * The path from research to a script, quietly, under Home's next step: each
 * step opens its view and says what is stored for the channel on screen.
 */
export function FlowStrip({
  counts,
  active,
}: {
  readonly counts: FlowCounts | null;
  readonly active: ViewId;
}) {
  const steps = flowSteps(counts);
  return (
    <nav aria-label="From research to a script" className="w-full px-space-md sm:px-space-lg">
      <ol className="flex flex-wrap gap-x-space-md gap-y-1">
        {steps.map((step) => (
          <li key={step.id} className="min-w-0">
            <a
              href={routeHash({ view: step.view, channelId: null, anchor: null })}
              aria-current={step.view === active ? 'step' : undefined}
              className="flex min-h-11 min-w-0 items-center gap-2 rounded px-1 text-body-sm transition-colors hover:text-on-surface focus:outline-none focus-visible:ring-1 focus-visible:ring-primary-container"
            >
              <span
                aria-hidden="true"
                className={`h-2 w-2 flex-none rounded-full ${step.done ? 'bg-primary-container' : 'bg-outline-variant'}`}
              />
              <span className="font-semibold text-on-surface">{step.label}</span>
              <span className="truncate text-outline">{step.count}</span>
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
