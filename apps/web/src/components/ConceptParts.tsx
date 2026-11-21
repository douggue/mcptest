import { needsSomething } from '@jgtube/core/src/concepts/parse';
import {
  ArrowRight,
  Bookmark,
  BookmarkCheck,
  ChevronDown,
  Shuffle,
  Smartphone,
  Sparkles,
} from 'lucide-react';
import { titleCheck, type ConceptView } from '../lib/ideaLab';
import { QUIET_BUTTON } from './LabStatus';

const ORIGIN: Readonly<Record<ConceptView['origin'], string | null>> = {
  batch: null,
  twist: 'Twist angle',
  more: 'More like this',
};

interface HeadProps {
  readonly number: number;
  readonly concept: ConceptView;
  readonly onKeep: (kept: boolean) => void;
  /** Opens the script writer for this concept; absent where there is none. */
  readonly onDraft?: (() => void) | undefined;
  /** The rest of the card is shown. */
  readonly open: boolean;
  readonly onToggle: () => void;
}

/** The title's length against what a phone's feed shows, as "68/55", amber when it may be cut. */
function LengthBadge({ concept }: { readonly concept: ConceptView }) {
  const check = titleCheck(concept.title, concept.length);
  return (
    <span
      title={check.warning ?? `${check.count} characters`}
      aria-label={check.warning ?? `${check.count} characters, fits a phone`}
      className={`flex-none rounded-full px-2 py-0.5 text-body-sm tabular-nums ${
        check.warning ? 'bg-metric-amber-bg text-metric-amber' : 'text-outline'
      }`}
    >
      {check.count}/{check.limit}
    </span>
  );
}

/** What kind of concept it is, in one quiet line. */
function kindLine(concept: ConceptView): string {
  return [
    concept.length === 'shorts' ? 'Short' : 'Long-form',
    ORIGIN[concept.origin],
    needsSomething(concept.needs) ? 'Look up facts first' : null,
  ]
    .filter((part) => part !== null)
    .join(' · ');
}

const ROW_BUTTON =
  'flex min-h-11 items-center gap-1.5 rounded px-2 text-body-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary-container';

/**
 * A concept as a compact row: its number, title and length, what kind it
 * is, then Keep, "Write the script" and the way to open the rest of the card.
 */
export function ConceptHead({ number, concept, onKeep, onDraft, open, onToggle }: HeadProps) {
  const KeepIcon = concept.kept ? BookmarkCheck : Bookmark;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex min-w-0 items-start gap-3">
        <span className="flex-none pt-0.5 text-body-md text-outline">{number}</span>
        <h3 className="min-w-0 flex-1 break-words text-title-md text-on-surface">
          {concept.title}
        </h3>
        <LengthBadge concept={concept} />
      </div>
      <p className="pl-7 text-body-sm text-outline">{kindLine(concept)}</p>
      <div className="flex flex-wrap items-center gap-1 pl-5">
        <button
          type="button"
          aria-pressed={concept.kept}
          onClick={() => onKeep(!concept.kept)}
          className={`${ROW_BUTTON} ${concept.kept ? 'text-primary' : 'text-on-surface-variant hover:text-on-surface'}`}
        >
          <KeepIcon aria-hidden="true" className="h-4 w-4" />
          {concept.kept ? 'Kept' : 'Keep'}
        </button>
        {onDraft && (
          <button
            type="button"
            onClick={onDraft}
            className={`${ROW_BUTTON} text-on-surface-variant hover:text-on-surface`}
          >
            Write the script
            <ArrowRight aria-hidden="true" className="h-4 w-4" />
          </button>
        )}
        <button
          type="button"
          aria-expanded={open}
          onClick={onToggle}
          className={`${ROW_BUTTON} ml-auto text-on-surface-variant hover:text-on-surface`}
        >
          {open ? 'Less' : 'Thumbnail and hook'}
          <ChevronDown
            aria-hidden="true"
            className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`}
          />
        </button>
      </div>
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
