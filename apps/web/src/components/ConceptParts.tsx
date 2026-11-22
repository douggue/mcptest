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

/** The title's length, shown only when a phone's feed may cut it, as "68/55". */
function LengthBadge({ concept }: { readonly concept: ConceptView }) {
  const check = titleCheck(concept.title, concept.length);
  if (!check.warning) return null;
  return (
    <span
      title={check.warning}
      aria-label={check.warning}
      className="flex-none rounded-full bg-surface-container-high px-2 py-0.5 text-body-sm tabular-nums text-on-surface-variant"
    >
      {check.count - check.limit} chars too long
    </span>
  );
}

/** What sets this concept apart, in a few words; empty for a plain long-form idea. */
function kindLine(concept: ConceptView): string {
  return [concept.length === 'shorts' ? 'Short' : null, ORIGIN[concept.origin]]
    .filter((part) => part !== null)
    .join(' · ');
}

const ICON_BUTTON =
  'flex h-11 min-w-11 flex-none items-center justify-center gap-1.5 rounded px-2 text-body-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary-container';

/**
 * A concept as one compact row: its number, title and, when a phone may cut
 * it, its length; then Keep, Write the script and the way to open the rest.
 */
export function ConceptHead({ number, concept, onKeep, onDraft, open, onToggle }: HeadProps) {
  const KeepIcon = concept.kept ? BookmarkCheck : Bookmark;
  const kind = kindLine(concept);
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
      <span className="w-5 flex-none text-body-md text-outline">{number}</span>
      <div className="flex min-w-0 flex-1 basis-60 flex-col">
        <h3 className="break-words text-title-md text-on-surface">{concept.title}</h3>
        {kind && <span className="text-body-sm text-outline">{kind}</span>}
      </div>
      <div className="ml-auto flex flex-none items-center gap-1">
        <LengthBadge concept={concept} />
        <button
          type="button"
          aria-pressed={concept.kept}
          aria-label={concept.kept ? 'Kept' : 'Keep'}
          title={concept.kept ? 'Kept' : 'Keep'}
          onClick={() => onKeep(!concept.kept)}
          className={`${ICON_BUTTON} ${concept.kept ? 'text-primary' : 'text-on-surface-variant hover:text-on-surface'}`}
        >
          <KeepIcon aria-hidden="true" className="h-5 w-5" />
        </button>
        {onDraft && (
          <button
            type="button"
            onClick={onDraft}
            className={`${ICON_BUTTON} text-on-surface-variant hover:text-on-surface`}
          >
            Write
            <ArrowRight aria-hidden="true" className="h-4 w-4" />
          </button>
        )}
        <button
          type="button"
          aria-expanded={open}
          aria-label={open ? 'Hide the thumbnail and hook' : 'Show the thumbnail and hook'}
          onClick={onToggle}
          className={`${ICON_BUTTON} text-on-surface-variant hover:text-on-surface`}
        >
          <ChevronDown
            aria-hidden="true"
            className={`h-5 w-5 transition-transform ${open ? 'rotate-180' : ''}`}
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
