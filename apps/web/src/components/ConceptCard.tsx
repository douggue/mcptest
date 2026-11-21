import type { BreakoutVideo } from '@jgtube/core';
import { needsSomething } from '@jgtube/core/src/concepts/parse';
import { liftedFrom } from '@jgtube/core/src/hooks/lift';
import { Bookmark, BookmarkCheck, PenLine, Shuffle, Sparkles, Smartphone } from 'lucide-react';
import { useState } from 'react';
import type { LibraryHook } from '../lib/hookLibrary';
import {
  hookModelOf,
  overlayNote,
  titleCheck,
  type ConceptThumbnailView,
  type ConceptView,
} from '../lib/ideaLab';
import { ConceptThumbnail } from './ConceptThumbnail';
import { VideoLine } from './VideoChips';
import { FeedPreview } from './FeedPreview';
import { PILL, PRIMARY_BUTTON, QUIET_BUTTON } from './LabStatus';

const LABEL = 'text-label-caps uppercase text-outline';
const ORIGIN: Readonly<Record<ConceptView['origin'], string | null>> = {
  batch: null,
  twist: 'Twist angle',
  more: 'More like this',
};

/** One title with its length, flagged when a phone would cut it. */
function TitleLine({ concept, title }: { readonly concept: ConceptView; readonly title: string }) {
  const check = titleCheck(title, concept.length);
  return (
    <li className="flex items-baseline justify-between gap-3">
      <span className="min-w-0 break-words text-body-md text-on-surface">{title}</span>
      <span
        className={`flex-none text-label-caps ${check.warning ? 'text-metric-amber' : 'text-outline'}`}
        title={check.warning ?? undefined}
      >
        {check.count}
      </span>
    </li>
  );
}

/** What the concept rests on: the engine's own line, then the picked videos it names, as links. */
function RestsOn({ concept }: { readonly concept: ConceptView }) {
  return (
    <div className="flex flex-col gap-1">
      <span className={LABEL}>Rests on</span>
      <p className="break-words text-body-sm text-on-surface-variant">{concept.restsOn}</p>
      {concept.restsOnVideos.length === 0 ? (
        <p className="text-body-sm text-metric-amber">
          It names none of the {concept.pickedCount} videos picked for it.
        </p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {concept.restsOnVideos.map((video) => (
            <li key={video.videoId} className="min-w-0">
              <VideoLine video={video} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The opening sentence, and the library hook whose way of opening it follows, when it names one. */
function Hook({
  concept,
  hooks,
}: {
  readonly concept: ConceptView;
  readonly hooks: readonly LibraryHook[];
}) {
  const model = hookModelOf(concept.hookStyle, hooks);
  const lift = liftedFrom(concept.hook, hooks);
  const liftedTitle = hooks.find((hook) => hook.videoId === lift?.videoId)?.title;
  return (
    <div className="flex flex-col gap-1">
      <span className={LABEL}>Opening sentence</span>
      <p className="text-body-md text-on-surface">{concept.hook}</p>
      {model && (
        <p className="text-body-sm text-on-surface-variant">
          Opens the way of{' '}
          <a href={`#hook-${model.videoId}`} className="text-primary hover:underline">
            {model.style ?? 'a hook in the library'}: {model.title}
          </a>
          . The way of opening only, never its words.
        </p>
      )}
      {lift && (
        <p role="note" className="break-words text-body-sm text-metric-amber">
          Shares {lift.words} words in a row with the opening of &ldquo;{liftedTitle}&rdquo;:
          &ldquo;{lift.phrase}&rdquo;. Reword it before you use it.
        </p>
      )}
      {!model && concept.hookStyle !== null && (
        <p className="break-words text-body-sm text-outline">Hook style: {concept.hookStyle}</p>
      )}
    </div>
  );
}

interface ActionsProps {
  readonly concept: ConceptView;
  readonly busy: boolean;
  readonly previewing: boolean;
  readonly onPreview: () => void;
  readonly onKeep: (kept: boolean) => void;
  readonly onGrow: (kind: 'twist' | 'more') => void;
  /** Opens the script writer for this concept; absent where there is none. */
  readonly onDraft?: (() => void) | undefined;
}

function Actions({ concept, busy, previewing, onPreview, onKeep, onGrow, onDraft }: ActionsProps) {
  const KeepIcon = concept.kept ? BookmarkCheck : Bookmark;
  const ICON = 'h-4 w-4';
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        aria-pressed={concept.kept}
        onClick={() => onKeep(!concept.kept)}
        className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-body-sm font-semibold transition-colors ${
          concept.kept
            ? 'bg-primary-container text-on-primary hover:opacity-90'
            : 'bg-surface-container-high text-primary ring-1 ring-primary-container hover:bg-primary-container hover:text-on-primary'
        }`}
      >
        <KeepIcon aria-hidden="true" className={ICON} />
        {concept.kept ? 'Kept' : 'Keep'}
      </button>
      {onDraft && (
        <button
          type="button"
          onClick={onDraft}
          className={`flex items-center gap-1.5 ${PRIMARY_BUTTON}`}
        >
          <PenLine aria-hidden="true" className={ICON} />
          Write the script
        </button>
      )}
      <button
        type="button"
        disabled={busy}
        onClick={() => onGrow('twist')}
        className={`flex items-center gap-1.5 ${QUIET_BUTTON}`}
      >
        <Shuffle aria-hidden="true" className={ICON} />
        Twist angle
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => onGrow('more')}
        className={`flex items-center gap-1.5 ${QUIET_BUTTON}`}
      >
        <Sparkles aria-hidden="true" className={ICON} />
        More like this
      </button>
      <button
        type="button"
        aria-pressed={previewing}
        onClick={onPreview}
        className={`flex items-center gap-1.5 ${QUIET_BUTTON}`}
      >
        <Smartphone aria-hidden="true" className={ICON} />
        {previewing ? 'Hide feed preview' : 'Feed preview'}
      </button>
    </div>
  );
}

interface Props extends Omit<ActionsProps, 'previewing' | 'onPreview'> {
  /** The hook library of this map, to link a hook style to its hook. */
  readonly hooks: readonly LibraryHook[];
  /** The breakouts of the map on screen, for the feed preview. */
  readonly breakouts: readonly BreakoutVideo[];
  /** The concept's stored thumbnail prompt; null when it has none. */
  readonly thumbnail: ConceptThumbnailView | null;
  readonly onThumbnail: () => void;
}

/** One packaging concept: the title large, then everything it comes with and what can be done with it. */
export function ConceptCard(props: Props) {
  const { concept, hooks, breakouts, thumbnail, onThumbnail, ...actions } = props;
  const [previewing, setPreviewing] = useState(false);
  const check = titleCheck(concept.title, concept.length);
  const tooManyWords = overlayNote(concept.overlay);
  const toLookUp = needsSomething(concept.needs);
  const origin = ORIGIN[concept.origin];
  return (
    <article
      id={`concept-${concept.id}`}
      className={`flex min-w-0 scroll-mt-16 flex-col gap-space-md rounded bg-surface-card p-space-md shadow-md ${
        concept.kept ? 'ring-1 ring-border-highlight' : ''
      }`}
    >
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          {origin && <span className={`${PILL} text-primary-fixed-dim`}>{origin}</span>}
          <span className={`${PILL} text-on-surface-variant`}>
            {concept.length === 'shorts' ? 'Short' : 'Long-form'}
          </span>
          <span
            className={`text-label-caps ${check.warning ? 'text-metric-amber' : 'text-outline'}`}
          >
            {check.count} characters
          </span>
        </div>
        <h3 className="break-words text-headline-md text-on-surface">{concept.title}</h3>
        {check.warning && <p className="text-body-sm text-metric-amber">{check.warning}</p>}
      </div>

      <div className="flex flex-col gap-1">
        <span className={LABEL}>Alternate titles · characters</span>
        <ul className="flex flex-col gap-1">
          {concept.altTitles.map((title) => (
            <TitleLine key={title} concept={concept} title={title} />
          ))}
        </ul>
      </div>

      <div className="grid grid-cols-1 gap-space-md sm:grid-cols-[minmax(0,1fr)_minmax(0,12rem)]">
        <div className="flex flex-col gap-1">
          <span className={LABEL}>Thumbnail</span>
          <p className="text-body-md text-on-surface">{concept.thumbnail}</p>
        </div>
        <div className="flex flex-col gap-1">
          <span className={LABEL}>Words on the thumbnail</span>
          <p className="break-words rounded bg-space-deep px-3 py-2 text-center text-title-md font-bold uppercase text-on-surface">
            {concept.overlay}
          </p>
          {tooManyWords && <p className="text-body-sm text-metric-amber">{tooManyWords}</p>}
        </div>
      </div>

      <ConceptThumbnail
        title={concept.title}
        thumbnail={thumbnail}
        busy={actions.busy}
        onWrite={onThumbnail}
      />

      <Hook concept={concept} hooks={hooks} />
      <RestsOn concept={concept} />

      <div
        className={`flex flex-col gap-1 rounded p-space-sm ${toLookUp ? 'bg-metric-amber-bg' : ''}`}
      >
        <span
          className={`text-label-caps uppercase ${toLookUp ? 'text-metric-amber' : 'text-outline'}`}
        >
          {toLookUp ? 'Look up before making it' : 'Needs'}
        </span>
        <p className="break-words text-body-sm text-on-surface">{concept.needs}</p>
      </div>

      <Actions
        concept={concept}
        previewing={previewing}
        onPreview={() => setPreviewing((shown) => !shown)}
        {...actions}
      />
      {previewing && <FeedPreview concept={concept} title={concept.title} breakouts={breakouts} />}
    </article>
  );
}
