import { ArrowRight } from 'lucide-react';
import type { ConceptView } from '../lib/ideaLab';
import { viewHref } from '../lib/routes';
import { Card } from './layout/Card';
import { Notice } from './layout/Notice';

interface Props {
  /** The channel's concepts; null while they are read. */
  readonly concepts: readonly ConceptView[] | null;
  /** The concepts with a script started; null while that is read. */
  readonly scripted: ReadonlySet<number> | null;
  /** Opens a concept's script, starting it when there is none. */
  readonly onOpen: (conceptId: number) => void;
}

const OPEN_BUTTON =
  'flex min-h-11 flex-none items-center gap-1.5 rounded-full bg-surface-container-high px-4 text-body-sm font-semibold text-on-surface transition-colors hover:bg-surface-container-highest focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary-container';

/**
 * With no script open: the kept ideas, each opening its script, so a script
 * is one press away on every return. Without a kept idea, the way to keep one.
 */
export function ScriptPicker({ concepts, scripted, onOpen }: Props) {
  if (concepts === null) return <Notice tone="working">Reading your ideas.</Notice>;
  // Scripts already started come first, as the one to carry on with.
  const started = (id: number): boolean => scripted?.has(id) ?? false;
  const kept = concepts
    .filter((concept) => concept.kept)
    .sort((a, b) => Number(started(b.id)) - Number(started(a.id)));
  if (kept.length === 0) {
    return (
      <Card>
        <h3 className="text-headline-md font-bold text-on-surface">Keep an idea first</h3>
        <p className="text-body-md text-on-surface-variant">
          A script is written for a kept idea. Keep one in Ideas, then come back.
        </p>
        <a
          href={viewHref('ideas')}
          className="flex min-h-12 w-fit items-center gap-2 rounded bg-primary-container px-5 text-body-md font-semibold text-on-primary hover:opacity-90"
        >
          Go to Ideas
          <ArrowRight aria-hidden="true" className="h-5 w-5" />
        </a>
      </Card>
    );
  }
  return (
    <Card label="Your kept ideas">
      <h3 className="text-headline-md font-bold text-on-surface">Your scripts</h3>
      <ul className="flex flex-col divide-y divide-border-subtle">
        {kept.map((concept) => (
          <li key={concept.id} className="flex min-w-0 flex-wrap items-center gap-space-md py-3">
            <span className="flex min-w-0 flex-1 basis-64 flex-col">
              <span className="break-words text-title-md text-on-surface">{concept.title}</span>
              <span className="text-body-sm text-outline">
                {started(concept.id) ? 'Script started' : 'No script yet'}
              </span>
            </span>
            <button type="button" className={OPEN_BUTTON} onClick={() => onOpen(concept.id)}>
              {started(concept.id) ? 'Continue' : 'Start the script'}
              <ArrowRight aria-hidden="true" className="h-4 w-4" />
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
