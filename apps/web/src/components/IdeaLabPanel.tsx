import type { TransferList } from '@jgtube/core';
import { Plus, Sparkles, X } from 'lucide-react';
import { libraryState } from '../lib/hookLibrary';
import { MAX_PICKS, formatOptions, generateBlocked } from '../lib/ideaLab';
import { thumbnailUrl } from '../lib/format';
import { viewHref } from '../lib/routes';
import { Answer, Credit } from './Answer';
import { EngineSelect, type AiChoice } from './AiEngines';
import { Field } from './layout/Card';
import { Details } from './layout/Details';
import { Segmented } from './layout/Segmented';
import { FIELD, LabStatus, NOTE, QUIET_BUTTON } from './LabStatus';
import { OriginLine } from './Origin';
import type { Lab } from './useLab';

const MAX_ANGLE_CHARS = 200;
const LENGTHS = [
  { value: 'long', label: 'Long-form' },
  { value: 'shorts', label: 'Shorts' },
] as const;
/** A text box: the field's look with square-ish corners, as it holds lines. */
const BOX = FIELD.replace('rounded-full', 'rounded-lg');
/** The panel's one primary action: full width, in the accent colour. */
const GENERATE =
  'flex w-full items-center justify-center gap-2 rounded-lg bg-primary-container py-2.5 text-body-md font-semibold text-on-primary shadow-[0_0_12px_rgba(0,210,255,0.35)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none';
const CHIP =
  'flex min-w-0 items-center gap-2 rounded-lg border border-border-subtle bg-space-deep py-1.5 pl-1.5 pr-1';
const REMOVE =
  'flex h-8 w-8 flex-none items-center justify-center rounded-full text-outline transition-colors hover:bg-surface-card hover:text-on-surface';

/** The videos picked as inspiration, as removable chips, with the way to pick more. */
function Picks({ lab }: { readonly lab: Lab }) {
  return (
    <Field
      label={`Inspiration (${lab.picks.length} of ${MAX_PICKS})`}
      action={
        <a
          href={viewHref('breakouts')}
          className="flex items-center gap-1 text-body-sm font-semibold text-primary hover:underline"
        >
          <Plus aria-hidden="true" className="h-4 w-4" />
          Pick videos
        </a>
      }
    >
      {lab.picks.length === 0 ? (
        <p className="text-body-sm text-on-surface-variant">
          Nothing picked yet. Use a video under Breaking out or a hook in the hook library.
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {lab.picks.map((pick) => (
            <li key={pick.videoId} className={CHIP}>
              <img
                src={thumbnailUrl(pick.videoId) ?? undefined}
                alt=""
                loading="lazy"
                referrerPolicy="no-referrer"
                className="aspect-video w-14 flex-none rounded bg-surface-container-high object-cover"
              />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-body-sm text-on-surface" title={pick.title}>
                  {pick.title}
                </span>
                <span className="truncate text-label text-outline">
                  {pick.channelTitle}
                  {pick.modelOpening ? ' · opening to model' : ''}
                </span>
              </span>
              <button
                type="button"
                aria-label={`Remove ${pick.title} from the inspiration`}
                onClick={() => lab.pick(pick)}
                className={REMOVE}
              >
                <X aria-hidden="true" className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Field>
  );
}

interface InputsProps {
  readonly lab: Lab;
  readonly busy: boolean;
  readonly transfers: TransferList | null;
}

/** The optional title format, with where it came from and the breakdown's formulas in use. */
function TitleFormat({ lab, busy, transfers }: InputsProps) {
  const { choices } = lab;
  const options = formatOptions(
    transfers?.formats ?? [],
    lab.formulas?.formulas ?? [],
    choices.fromIdea ?? null,
  );
  const origin = choices.format.startsWith('formula:')
    ? 'formula'
    : choices.fromIdea && choices.format === `transfer:${choices.fromIdea.key}`
      ? 'transfer'
      : null;
  const groups = [...new Set(options.map((option) => option.group))];
  return (
    <Field label="Title format (optional)">
      <select
        aria-label="Title format"
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
      {origin && <OriginLine origin={origin} what="Format" />}
      {choices.formulasFrom && (
        <div className={`${CHIP} pl-3`}>
          <span className="min-w-0 flex-1 text-body-sm text-on-surface">
            <OriginLine
              origin="breakdown"
              what="Title formulas"
              name={choices.formulasFrom.title}
            />
          </span>
          <button
            type="button"
            aria-label="Stop using the breakdown's title formulas"
            onClick={() => lab.choose({ formulasFrom: null })}
            className={REMOVE}
          >
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>
      )}
    </Field>
  );
}

/** A line about the hook library when it cannot yet serve the concepts. */
function LibraryHint({ lab, busy }: { readonly lab: Lab; readonly busy: boolean }) {
  if (lab.library === null || libraryState(lab.library.hooks).built) return null;
  return (
    <div className="flex flex-col items-start gap-2 text-body-sm text-on-surface-variant">
      The hook library is not built for this channel, so concepts cannot follow how its breakouts
      open. The lab works without it.
      <button type="button" disabled={busy} onClick={lab.buildHooks} className={QUIET_BUTTON}>
        Build the hook library
      </button>
    </div>
  );
}

/** "Where else this could work", behind a disclosure: the button, what it cannot know, its answer. */
function WhereElse({ lab, busy }: { readonly lab: Lab; readonly busy: boolean }) {
  return (
    <Details summary="Where else this could work">
      <p className="text-body-sm text-on-surface-variant">
        Suggests other languages and categories this map&rsquo;s formats could be made for, each
        with a phrase to search on YouTube. An AI run of a minute or two.
      </p>
      <button type="button" disabled={busy} onClick={lab.askWhereElse} className={QUIET_BUTTON}>
        Suggest where else
      </button>
      <LabStatus
        state={lab.jobs.state}
        kinds={['where-else']}
        working="Asking the AI where else this could work"
        takes="This usually takes a minute or two."
      />
      {lab.whereElse && (
        <>
          <p className={NOTE}>
            Jgtube has not looked at YouTube in any other language or category. Each suggestion is a
            place to check with its search phrase, not a finding that it is untried there.
          </p>
          <Answer text={lab.whereElse.text} />
          <Credit answer={lab.whereElse} />
        </>
      )}
    </Details>
  );
}

interface Props extends InputsProps {
  readonly centerTitle: string;
  /** Which AI answers; absent where the choice is made elsewhere. */
  readonly ai?: AiChoice;
}

/**
 * The idea lab's controls: what the concepts rest on (the picks, a format,
 * an angle and the length), which AI writes them, and the one button.
 */
export function IdeaLabPanel({ lab, busy, transfers, centerTitle, ai }: Props) {
  const { choices } = lab;
  const blocked = generateBlocked(lab.picks, busy);
  return (
    <>
      <div className="flex flex-col gap-1">
        <h2 id="idea-lab-title" className="text-headline-md font-bold text-on-surface">
          Make new ideas
        </h2>
        <p className="text-body-sm text-on-surface-variant">
          From videos on {centerTitle}&rsquo;s map, a format and your angle.
        </p>
      </div>
      <Picks lab={lab} />
      <Field label={`Your topic or angle · ${choices.angle.length} of ${MAX_ANGLE_CHARS}`}>
        <textarea
          aria-label="Your topic or angle"
          value={choices.angle}
          maxLength={MAX_ANGLE_CHARS}
          rows={3}
          onChange={(event) => lab.choose({ angle: event.target.value })}
          disabled={busy}
          placeholder="Optional: one line, in your own words"
          className={`${BOX} resize-y`}
        />
      </Field>
      <Field label="Format">
        <Segmented
          label="Length"
          fill
          options={LENGTHS}
          value={choices.length}
          onChange={(length) => lab.choose({ length })}
          disabled={busy}
        />
      </Field>
      <TitleFormat lab={lab} busy={busy} transfers={transfers} />
      {ai && (
        <Field label="AI">
          <EngineSelect ai={ai} />
        </Field>
      )}
      <LibraryHint lab={lab} busy={busy} />
      <div className="flex flex-col gap-1.5" aria-live="polite">
        <button
          type="button"
          disabled={blocked !== null}
          onClick={lab.generate}
          className={GENERATE}
        >
          <Sparkles aria-hidden="true" className="h-4 w-4" />
          Write 10 ideas
        </button>
        <span
          className={`text-center text-body-sm ${blocked ? 'text-metric-amber' : 'text-outline'}`}
        >
          {blocked ?? 'About two to four minutes. Replaces the ideas not kept.'}
        </span>
      </div>
      <WhereElse lab={lab} busy={busy} />
      <Details summary="How this works">
        <p className="text-body-sm text-on-surface-variant">
          Each concept is a title, two alternates, a thumbnail, its words and an opening sentence.
          The AI cannot look anything up, so each concept says what you must check before making it.
          Writing a batch is an AI run of two to four minutes and uses some of that AI&rsquo;s plan
          allowance. &ldquo;Thumbnail prompt&rdquo;, under a concept&rsquo;s details, looks at the
          winning thumbnails and reads your thumbnail review when there is one.
        </p>
      </Details>
    </>
  );
}
