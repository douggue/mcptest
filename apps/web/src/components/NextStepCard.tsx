import { ArrowRight } from 'lucide-react';
import { nextStep, type FlowCounts } from '../lib/flow';
import { viewHref } from '../lib/routes';
import { FlowStrip } from './FlowStrip';
import { Card } from './layout/Card';
import { Notice } from './layout/Notice';
import { Skeleton } from './ui/States';

interface Props {
  readonly counts: FlowCounts | null;
  /** Why the counts could not be read, if they could not. */
  readonly problem: string | null;
  readonly centerTitle: string;
}

/** Home's one obvious action: the next step for the channel on screen, and the path so far. */
export function NextStepCard({ counts, problem, centerTitle }: Props) {
  if (problem) return <Notice tone="problem">{problem}</Notice>;
  if (!counts) {
    // The card's own height, so what is under it does not jump when the counts arrive.
    return (
      <Card label="Your next step">
        <div role="status" aria-label="Working out your next step" className="flex flex-col gap-3">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-5 w-1/2" />
          <Skeleton className="h-12 w-44" />
          <Skeleton className="mt-4 h-16 w-full" />
        </div>
      </Card>
    );
  }
  const step = nextStep(counts);
  return (
    <Card label="Your next step">
      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-body-sm text-outline">Next for {centerTitle}</span>
        <h3 className="text-headline-md font-bold text-on-surface">{step.title}</h3>
        <p className="text-body-md text-on-surface-variant">{step.line}</p>
      </div>
      <a
        href={viewHref(step.view)}
        className="flex min-h-12 w-fit items-center gap-2 rounded bg-primary-container px-5 text-body-md font-semibold text-on-primary transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        {step.action}
        <ArrowRight aria-hidden="true" className="h-5 w-5" />
      </a>
      <div className="-mx-space-md border-t border-border-subtle pt-space-sm sm:-mx-space-lg">
        <FlowStrip counts={counts} active="home" />
      </div>
    </Card>
  );
}
