import type { BreakoutVideo } from '@jgtube/core';
import { needsSomething } from '@jgtube/core/src/concepts/parse';
import { liftedFrom } from '@jgtube/core/src/hooks/lift';
import { useState } from 'react';
import type { LibraryHook } from '../lib/hookLibrary';
import {
  hookModelOf,
  overlayNote,
  titleCheck,
  type ConceptThumbnailView,
  type ConceptView,
} from '../lib/ideaLab';
import { ConceptActions, ConceptTopRow } from './ConceptParts';
import { ConceptThumbnail } from './ConceptThumbnail';
import { FeedPreview } from './FeedPreview';
import { Card } from './layout/Card';
import { Details } from './layout/Details';
import { VideoLine } from './VideoChips';

const LABEL = 'text-label text-outline';

/** One title with its length, flagged when a phone would cut it. */
function TitleLine({ concept, title }: { readonly concept: ConceptView; readonly title: string }) {
  const check = titleCheck(title, concept.length);
  return (
    <li className="flex items-baseline justify-between gap-3">
      <span className="min-w-0 break-words text-body-md text-on-surface">{title}</span>
      <span
        className={`flex-none text-label ${check.warning ? 'text-metric-amber' : 'text-outline'}`}
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

interface HookProps {
  readonly concept: ConceptView;
  readonly hooks: readonly LibraryHook[];
}

/** The library hook whose way of opening the concept follows, when it names one. */
function HookModel({ concept, hooks }: HookProps) {
  const model = hookModelOf(concept.hookStyle, hooks);
  if (model) {
    return (
      <p className="text-body-sm text-on-surface-variant">
        Opens the way of{' '}
        <a href={`#hook-${model.videoId}`} className="text-primary hover:underline">
          {model.style ?? 'a hook in the library'}: {model.title}
        </a>
        . The way of opening only, never its words.
      </p>
    );
  }
  return concept.hookStyle === null ? null : (
    <p className="break-words text-body-sm text-outline">Hook style: {concept.hookStyle}</p>
  );
}

/** The opening sentence, and a warning when it lifts words from a breakout's opening. */
function Opening({ concept, hooks }: HookProps) {
  const lift = liftedFrom(concept.hook, hooks);
  const liftedTitle = hooks.find((hook) => hook.videoId === lift?.videoId)?.title;
  return (
    <div className="flex flex-col gap-1.5">
      <span className={LABEL}>1-sentence opening hook</span>
      <p className="text-body-lg text-on-surface">{concept.hook}</p>
      {lift && (
        <p role="note" className="break-words text-body-sm text-metric-amber">
          Shares {lift.words} words in a row with the opening of &ldquo;{liftedTitle}&rdquo;:
          &ldquo;{lift.phrase}&rdquo;. Reword it before you use it.
        </p>
      )}
    </div>
  );
}

/** The thumbnail brief in a box, with the words on it as a chip at the right. */
function ThumbnailBrief({ concept }: { readonly concept: ConceptView }) {
  const tooManyWords = overlayNote(concept.overlay);
  return (
    <div className="grid min-w-0 grid-cols-1 gap-space-md rounded-lg border border-border-subtle bg-space-deep p-space-md sm:grid-cols-[minmax(0,1fr)_auto]">
      <div className="flex min-w-0 flex-col gap-1">
        <span className={LABEL}>Thumbnail brief</span>
        <p className="break-words text-body-md text-on-surface">{concept.thumbnail}</p>
      </div>
      <div className="flex min-w-0 flex-col gap-1 sm:items-end">
        <span className={LABEL}>Overlay text</span>
        <span className="max-w-[16rem] break-words rounded bg-metric-amber-bg px-3 py-1.5 text-title-md font-bold uppercase text-metric-amber">
          {concept.overlay}
        </span>
        {tooManyWords && <p className="text-body-sm text-metric-amber">{tooManyWords}</p>}
      </div>
    </div>
  );
}

/** What most owners need only sometimes, behind one disclosure that starts closed. */
function ConceptDetails(props: Props) {
  const { concept, hooks, thumbnail, onThumbnail, busy } = props;
  const toLookUp = needsSomething(concept.needs);
  return (
    <Details summary="Details">
      <HookModel concept={concept} hooks={hooks} />
      <RestsOn concept={concept} />
      <div
        className={`flex flex-col gap-1 rounded p-space-sm ${toLookUp ? 'bg-metric-amber-bg' : ''}`}
      >
        <span className={`text-label ${toLookUp ? 'text-metric-amber' : 'text-outline'}`}>
          {toLookUp ? 'Look up before making it' : 'Needs'}
        </span>
        <p className="break-words text-body-sm text-on-surface">{concept.needs}</p>
      </div>
      <ConceptThumbnail
        title={concept.title}
        thumbnail={thumbnail}
        busy={busy}
        onWrite={onThumbnail}
      />
    </Details>
  );
}

interface Props {
  /** Its place in the list, from 1. */
  readonly number: number;
  readonly concept: ConceptView;
  readonly busy: boolean;
  readonly onKeep: (kept: boolean) => void;
  readonly onGrow: (kind: 'twist' | 'more') => void;
  /** Opens the script writer for this concept; absent where there is none. */
  readonly onDraft?: (() => void) | undefined;
  /** The hook library of this map, to link a hook style to its hook. */
  readonly hooks: readonly LibraryHook[];
  /** The breakouts of the map on screen, for the feed preview. */
  readonly breakouts: readonly BreakoutVideo[];
  /** The concept's stored thumbnail prompt; null when it has none. */
  readonly thumbnail: ConceptThumbnailView | null;
  readonly onThumbnail: () => void;
}

/**
 * One packaging concept, roomy: its number, Keep and "Write the script" on
 * top; the title large; the thumbnail brief with its words; the opening
 * sentence; then small buttons. What it rests on, what to look up, the
 * thumbnail prompt and the hook it follows sit behind one Details.
 */
export function ConceptCard(props: Props) {
  const { number, concept, hooks, breakouts, busy } = props;
  const [previewing, setPreviewing] = useState(false);
  const check = titleCheck(concept.title, concept.length);
  return (
    <Card as="article" id={`concept-${concept.id}`} highlighted={concept.kept}>
      <ConceptTopRow
        number={number}
        concept={concept}
        onKeep={props.onKeep}
        onDraft={props.onDraft}
      />
      <div className="flex flex-col gap-1">
        <h3 className="break-words text-headline-lg font-bold leading-tight text-on-surface">
          {concept.title}
        </h3>
        <p className={`text-body-sm ${check.warning ? 'text-metric-amber' : 'text-outline'}`}>
          {check.count} characters{check.warning ? `. ${check.warning}` : ''}
        </p>
      </div>
      {concept.altTitles.length > 0 && (
        <Details summary={`Alternate titles (${concept.altTitles.length})`}>
          <ul className="flex flex-col gap-1">
            {concept.altTitles.map((title) => (
              <TitleLine key={title} concept={concept} title={title} />
            ))}
          </ul>
        </Details>
      )}
      <ThumbnailBrief concept={concept} />
      <Opening concept={concept} hooks={hooks} />
      <ConceptActions
        busy={busy}
        previewing={previewing}
        onPreview={() => setPreviewing((shown) => !shown)}
        onGrow={props.onGrow}
      />
      {previewing && <FeedPreview concept={concept} title={concept.title} breakouts={breakouts} />}
      <ConceptDetails {...props} />
    </Card>
  );
}
