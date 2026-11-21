import type { BreakoutVideo, TransferList } from '@jgtube/core';
import { Lightbulb, X } from 'lucide-react';
import { libraryState } from '../lib/hookLibrary';
import {
  MAX_PICKS,
  canGenerate,
  formatOptions,
  thumbnailFor,
  type ConceptView,
} from '../lib/ideaLab';
import { thumbnailUrl } from '../lib/format';
import { Answer, Credit } from './Answer';
import { OriginLine } from './Origin';
import { SectionFrame } from './SectionFrame';
import { ConceptCard } from './ConceptCard';
import { FIELD, LabStatus, NOTE, PRIMARY_BUTTON, QUIET_BUTTON } from './LabStatus';
import type { Lab } from './useLab';

const MAX_ANGLE_CHARS = 200;
const LABEL = 'text-label-caps uppercase text-outline';
const LENGTHS = [
  { id: 'long', label: 'Long-form' },
  { id: 'shorts', label: 'Shorts' },
] as const;

/** The videos picked as inspiration, each with a way to take it out again. */
function Picks({ lab }: { readonly lab: Lab }) {
  return (
    <div className="flex flex-col gap-2">
      <span className={LABEL}>
        Inspiration · {lab.picks.length} of {MAX_PICKS}
      </span>
      {lab.picks.length === 0 ? (
        <p className="text-body-sm text-on-surface-variant">
          Nothing picked yet. Press &ldquo;Use as inspiration&rdquo; on a video under Breaking out
          right now, or &ldquo;Use in idea lab&rdquo; on a hook in the hook library.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {lab.picks.map((pick) => (
            <li key={pick.videoId} className="flex items-center gap-2">
              <img
                src={thumbnailUrl(pick.videoId) ?? undefined}
                alt=""
                loading="lazy"
                referrerPolicy="no-referrer"
                className="aspect-video w-20 flex-none rounded bg-surface-container-high object-cover"
              />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-body-sm text-on-surface">
                  {pick.title}
                  <span className="text-outline"> · {pick.channelTitle}</span>
                  {pick.modelOpening && (
                    <span className="text-primary-fixed-dim"> · opening to model</span>
                  )}
                </span>
                {pick.from && <OriginLine origin={pick.from} what="Picked" />}
              </span>
              <button
                type="button"
                aria-label={`Remove ${pick.title} from the inspiration`}
                onClick={() => lab.pick(pick)}
                className="flex-none rounded-full p-1 text-outline transition-colors hover:bg-surface-container-high hover:text-on-surface"
              >
                <X aria-hidden="true" className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface InputsProps {
  readonly lab: Lab;
  readonly busy: boolean;
  readonly transfers: TransferList | null;
}

/** What a batch is asked for: the format, the angle and the length. */
function Inputs({ lab, busy, transfers }: InputsProps) {
  const options = formatOptions(
    transfers?.formats ?? [],
    lab.formulas?.formulas ?? [],
    lab.choices.fromIdea ?? null,
  );
  const formatOrigin = lab.choices.format.startsWith('formula:')
    ? 'formula'
    : lab.choices.fromIdea && lab.choices.format === `transfer:${lab.choices.fromIdea.key}`
      ? 'transfer'
      : null;
  const groups = [...new Set(options.map((option) => option.group))];
  const { choices } = lab;
  return (
    <div className="grid grid-cols-1 gap-space-md lg:grid-cols-2">
      <label className="flex min-w-0 flex-col gap-1">
        <span className={LABEL}>Title format (optional)</span>
        <select
          value={options.some((option) => option.value === choices.format) ? choices.format : ''}
          onChange={(event) => lab.choose({ format: event.target.value })}
          disabled={busy}
          className={FIELD}
        >
          <option value="">No format: word each title freely</option>
          {groups.map((group) => (
            <optgroup key={group} label={group}>
              {options
                .filter((option) => option.group === group)
                .map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
        {formatOrigin && <OriginLine origin={formatOrigin} what="Format" />}
      </label>
      {choices.formulasFrom && (
        <div className="flex min-w-0 flex-wrap items-center gap-2 rounded bg-space-deep px-3 py-2 lg:col-span-2">
          <OriginLine origin="breakdown" what="Title formulas" name={choices.formulasFrom.title} />
          <button
            type="button"
            onClick={() => lab.choose({ formulasFrom: null })}
            className={QUIET_BUTTON}
          >
            Stop using them
          </button>
        </div>
      )}
      <label className="flex min-w-0 flex-col gap-1">
        <span className={LABEL}>
          Your topic or angle (optional) · {choices.angle.length} of {MAX_ANGLE_CHARS}
        </span>
        <input
          type="text"
          value={choices.angle}
          maxLength={MAX_ANGLE_CHARS}
          onChange={(event) => lab.choose({ angle: event.target.value })}
          disabled={busy}
          placeholder="One line, in your own words"
          className={FIELD}
        />
      </label>
      <div role="radiogroup" aria-label="Length" className="flex flex-wrap items-center gap-2">
        <span className={LABEL}>Length</span>
        {LENGTHS.map((length) => (
          <button
            key={length.id}
            type="button"
            role="radio"
            aria-checked={choices.length === length.id}
            disabled={busy}
            onClick={() => lab.choose({ length: length.id })}
            className={`rounded-full px-3 py-1 text-body-sm font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-60 ${
              choices.length === length.id
                ? 'bg-primary-container text-space-deep'
                : 'bg-surface-container-high text-on-surface-variant hover:text-on-surface'
            }`}
          >
            {length.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** A line about the hook library when it cannot yet serve the concepts. */
function LibraryHint({ lab, busy }: { readonly lab: Lab; readonly busy: boolean }) {
  if (lab.library === null || libraryState(lab.library.hooks).built) return null;
  return (
    <p className="flex flex-wrap items-center gap-2 text-body-sm text-on-surface-variant">
      The hook library has not been built for this channel, so the concepts cannot follow how its
      breakout videos really open. The lab works without it.
      <button type="button" disabled={busy} onClick={lab.buildHooks} className={QUIET_BUTTON}>
        Build the hook library
      </button>
    </p>
  );
}

/** "Where else this could work": the button, what it cannot know, and its answer. */
function WhereElse({ lab, busy }: { readonly lab: Lab; readonly busy: boolean }) {
  return (
    <div className="flex flex-col gap-space-sm">
      <div className="flex flex-col gap-2 rounded bg-surface-card p-space-md">
        <h3 className="text-title-md text-on-surface">Where else this could work</h3>
        <p className="text-body-sm text-on-surface-variant">
          Takes the title formats and winning ideas of this map and suggests other languages and
          other categories they could be made for, each with the exact phrase to search on YouTube.
          An AI run of a minute or two.
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={lab.askWhereElse}
          className={`self-start ${PRIMARY_BUTTON}`}
        >
          Suggest where else
        </button>
      </div>
      <LabStatus
        state={lab.jobs.state}
        kinds={['where-else']}
        working="Asking the AI where else this could work"
        takes="This usually takes a minute or two."
      />
      {lab.whereElse && (
        <>
          <p className={NOTE}>
            Jgtube has not looked at YouTube in any other language or category. Every suggestion
            below is a place to check with the search phrase it gives, not a finding that it is
            untried there.
          </p>
          <Answer text={lab.whereElse.text} />
          <Credit answer={lab.whereElse} />
        </>
      )}
    </div>
  );
}

interface Props extends InputsProps {
  readonly centerTitle: string;
  /** The breakouts of the map on screen, for the feed preview. */
  readonly breakouts: readonly BreakoutVideo[];
  /** Opens the script writer for a concept; absent where there is none. */
  readonly onDraft?: ((concept: ConceptView) => void) | undefined;
}

/**
 * The idea lab: pick videos from this map, optionally a title format and an
 * angle, and have an AI write ten packaging concepts that rest on them. The
 * kept ones stay; the rest go when the next batch comes or on request.
 */
export function IdeaLab({ lab, busy, transfers, centerTitle, breakouts, onDraft }: Props) {
  const concepts = lab.concepts ?? [];
  const unkept = concepts.filter((concept) => !concept.kept).length;
  const hooks = lab.library?.hooks ?? [];
  return (
    <SectionFrame
      id="idea-lab"
      titleId="idea-lab-title"
      title="Idea lab"
      icon={Lightbulb}
      summary={concepts.length > 0 ? `${concepts.length} concepts` : undefined}
      lead={
        <>
          Pick up to {MAX_PICKS} videos from the map around {centerTitle}; an AI writes ten
          packaging concepts that rest on them.
        </>
      }
      howItWorks={
        <>
          <p>
            Each concept is a title, two alternates, a thumbnail, its words and an opening sentence.
            The AI cannot look anything up, so each concept says what you must check before making
            it.
          </p>
          <p>
            Writing a batch is an AI run of two to four minutes, using the AI chosen under Ask AI,
            and uses some of its plan allowance. A new batch replaces the concepts not kept.
            &ldquo;Thumbnail prompt&rdquo; looks at the winning thumbnails and writes a prompt for
            one concept; it reads your thumbnail review when there is one.
          </p>
        </>
      }
    >
      <div className="flex flex-col gap-space-md rounded bg-surface-card p-space-md shadow-md">
        <Picks lab={lab} />
        <Inputs lab={lab} busy={busy} transfers={transfers} />
        <LibraryHint lab={lab} busy={busy} />
        <div className="flex flex-wrap items-center gap-space-sm">
          <button
            type="button"
            disabled={!canGenerate(lab.picks, busy)}
            onClick={lab.generate}
            className={PRIMARY_BUTTON}
          >
            Write 10 concepts
          </button>
          <span className="text-body-sm text-outline">An AI run of two to four minutes.</span>
        </div>
      </div>

      <LabStatus
        state={lab.jobs.state}
        kinds={['batch', 'twist', 'more', 'thumbnail']}
        working="Asking the AI"
        takes="This usually takes two to four minutes."
      />
      {lab.problem && (
        <p role="alert" className="rounded bg-surface-card p-space-lg text-body-md text-error">
          {lab.problem}
        </p>
      )}
      {lab.conceptNote && <p className={NOTE}>{lab.conceptNote}</p>}

      {concepts.length > 0 && (
        <div className="flex flex-col gap-space-md">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className={LABEL}>
              {concepts.length - unkept} kept · {unkept} not kept. A new batch replaces the ones not
              kept.
            </span>
            {unkept > 0 && (
              <button type="button" onClick={lab.clear} className={QUIET_BUTTON}>
                Clear the ones not kept ({unkept})
              </button>
            )}
          </div>
          <div className="grid grid-cols-1 gap-space-md xl:grid-cols-2">
            {concepts.map((concept) => (
              <ConceptCard
                key={concept.id}
                concept={concept}
                hooks={hooks}
                breakouts={breakouts}
                busy={busy}
                onKeep={(kept) => lab.keep(concept.id, kept)}
                onGrow={(kind) => lab.grow(kind, concept.id)}
                thumbnail={thumbnailFor(lab.thumbnails, concept.id)}
                onThumbnail={() => lab.writeThumbnail(concept.id)}
                onDraft={onDraft ? () => onDraft(concept) : undefined}
              />
            ))}
          </div>
        </div>
      )}

      <WhereElse lab={lab} busy={busy} />
    </SectionFrame>
  );
}
