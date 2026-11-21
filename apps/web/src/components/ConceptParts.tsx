import { needsSomething } from '@jgtube/core/src/concepts/parse';
import { ArrowRight, Bookmark, BookmarkCheck, Shuffle, Smartphone, Sparkles } from 'lucide-react';
import type { ConceptView } from '../lib/ideaLab';
import { PILL, QUIET_BUTTON } from './LabStatus';

const ORIGIN: Readonly<Record<ConceptView['origin'], string | null>> = {
  batch: null,
  twist: 'Twist angle',
  more: 'More like this',
};

interface TopProps {
  readonly number: number;
  readonly concept: ConceptView;
  readonly onKeep: (kept: boolean) => void;
  /** Opens the script writer for this concept; absent where there is none. */
  readonly onDraft?: (() => void) | undefined;
}

/** A concept card's top row: its number and Keep at the left, the one primary action at the right. */
export function ConceptTopRow({ number, concept, onKeep, onDraft }: TopProps) {
  const KeepIcon = concept.kept ? BookmarkCheck : Bookmark;
  const origin = ORIGIN[concept.origin];
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-body-md text-outline">#{number}</span>
      <button
        type="button"
        aria-pressed={concept.kept}
        onClick={() => onKeep(!concept.kept)}
        className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-body-sm font-semibold transition-colors ${
          concept.kept
            ? 'border-primary-container bg-primary-container text-on-primary'
            : 'border-border-subtle text-on-surface-variant hover:text-on-surface'
        }`}
      >
        <KeepIcon aria-hidden="true" className="h-4 w-4" />
        {concept.kept ? 'Kept' : 'Keep'}
      </button>
      {origin && <span className={`${PILL} text-primary-fixed-dim`}>{origin}</span>}
      <span className={`${PILL} text-on-surface-variant`}>
        {concept.length === 'shorts' ? 'Short' : 'Long-form'}
      </span>
      {needsSomething(concept.needs) && (
        <span className={`${PILL} text-metric-amber`}>Look up first</span>
      )}
      {onDraft && (
        <button
          type="button"
          onClick={onDraft}
          className="ml-auto flex items-center gap-1.5 rounded-lg bg-primary-container px-3 py-1.5 text-body-sm font-semibold text-on-primary transition-opacity hover:opacity-90"
        >
          Write the script
          <ArrowRight aria-hidden="true" className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

interface ActionsProps {
  readonly busy: boolean;
  readonly previewing: boolean;
  readonly onPreview: () => void;
  readonly onGrow: (kind: 'twist' | 'more') => void;
}

/** The small secondary buttons under a concept. */
export function ConceptActions({ busy, previewing, onPreview, onGrow }: ActionsProps) {
  const SMALL = `flex items-center gap-1.5 ${QUIET_BUTTON}`;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" disabled={busy} onClick={() => onGrow('twist')} className={SMALL}>
        <Shuffle aria-hidden="true" className="h-4 w-4" />
        Twist angle
      </button>
      <button type="button" disabled={busy} onClick={() => onGrow('more')} className={SMALL}>
        <Sparkles aria-hidden="true" className="h-4 w-4" />
        More like this
      </button>
      <button type="button" aria-pressed={previewing} onClick={onPreview} className={SMALL}>
        <Smartphone aria-hidden="true" className="h-4 w-4" />
        {previewing ? 'Hide feed preview' : 'Feed preview'}
      </button>
    </div>
  );
}
