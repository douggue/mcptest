import { liftedFrom } from '@jgtube/core/src/hooks/lift';
import { SCRIPT_STATUSES } from '@jgtube/core/src/script/types';
import { PenLine } from 'lucide-react';
import { useState } from 'react';
import { formatScore } from '../lib/format';
import type { LibraryHook } from '../lib/hookLibrary';
import {
  MAX_MODELS,
  clockOf,
  stageStates,
  toggleModel,
  voiceNote,
  type ScriptStage,
  type ScriptView,
  type StageState,
  type VoiceChoice,
} from '../lib/scriptWriter';
import { FIELD, LabStatus, NOTE, PILL, PRIMARY_BUTTON, QUIET_BUTTON } from './LabStatus';
import { thumbnailFor } from '../lib/ideaLab';
import { ConceptThumbnail } from './ConceptThumbnail';
import { ScriptEditor } from './ScriptEditor';
import type { Lab } from './useLab';
import type { Script } from './useScript';

const LABEL = 'text-label-caps uppercase text-outline';
const CARD = 'flex min-w-0 flex-col gap-space-md rounded bg-surface-card p-space-md shadow-md';
const AREA =
  'w-full min-w-0 rounded bg-space-deep p-space-sm text-body-sm text-on-surface shadow-[inset_0_2px_6px_rgba(0,0,0,0.6)] focus:outline-none focus-visible:ring-1 focus-visible:ring-primary-container';
const STATUS_NAMES = { idea: 'Idea', drafting: 'Drafting', ready: 'Ready' } as const;
const SECONDS_PER_MINUTE = 60;

interface PartProps {
  readonly script: Script;
  readonly view: ScriptView;
  readonly busy: boolean;
}

/** Where the script stands, and the voice, rate and length it is written to. */
function Setup({
  script,
  view,
  busy,
  voices,
}: PartProps & { readonly voices: readonly VoiceChoice[] }) {
  const stored = view.script;
  if (!stored) return null;
  const shorts = view.concept.length === 'shorts';
  const range = view.lengthRange;
  const minutes = (seconds: number): number => Math.round(seconds / SECONDS_PER_MINUTE);
  return (
    <div className={CARD}>
      <div className="grid grid-cols-1 gap-space-md md:grid-cols-2 xl:grid-cols-4">
        <label className="flex min-w-0 flex-col gap-1">
          <span className={LABEL}>Status</span>
          <select
            value={stored.status}
            onChange={(event) =>
              script.change({
                status: SCRIPT_STATUSES.find((status) => status === event.target.value) ?? 'idea',
              })
            }
            className={FIELD}
          >
            {SCRIPT_STATUSES.map((status) => (
              <option key={status} value={status}>
                {STATUS_NAMES[status]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-0 flex-col gap-1">
          <span className={LABEL}>Voice: write it the way this channel speaks</span>
          <select
            value={stored.voiceChannelId ?? ''}
            onChange={(event) => script.change({ voiceChannelId: event.target.value })}
            disabled={busy}
            className={FIELD}
          >
            {stored.voiceChannelId === null && <option value="">Choose a channel</option>}
            {voices.map((voice) => (
              <option key={voice.id} value={voice.id}>
                {voice.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-0 flex-col gap-1">
          <span className={LABEL}>Words a minute</span>
          <input
            type="number"
            min={60}
            max={400}
            value={stored.wordsPerMinute ?? ''}
            onChange={(event) => {
              const rate = Math.round(Number(event.target.value));
              if (rate > 0) script.change({ wordsPerMinute: rate });
            }}
            placeholder="Not known yet"
            className={FIELD}
          />
        </label>
        <label className="flex min-w-0 flex-col gap-1">
          <span className={LABEL}>
            Length: {clockOf(stored.targetSeconds)}
            {shorts ? ' · a Short, under a minute' : ''}
          </span>
          {shorts || range ? (
            <input
              type="range"
              min={shorts ? 15 : minutes(range?.minSeconds ?? 0)}
              max={shorts ? 59 : minutes(range?.maxSeconds ?? 0)}
              value={shorts ? (stored.targetSeconds ?? 50) : minutes(stored.targetSeconds ?? 0)}
              onChange={(event) => {
                const value = Number(event.target.value);
                script.change({ targetSeconds: shorts ? value : value * SECONDS_PER_MINUTE });
              }}
              className="w-full accent-primary-container"
            />
          ) : (
            <input
              type="number"
              min={1}
              max={240}
              value={stored.targetSeconds === null ? '' : minutes(stored.targetSeconds)}
              onChange={(event) => {
                const value = Math.round(Number(event.target.value));
                if (value > 0) script.change({ targetSeconds: value * SECONDS_PER_MINUTE });
              }}
              placeholder="Minutes"
              className={FIELD}
            />
          )}
        </label>
      </div>
      <p className="text-body-sm text-on-surface-variant">{voiceNote(view.voice)}</p>
      {view.voice && view.voice.toRead > 0 && (
        <p className="flex flex-wrap items-center gap-2 text-body-sm text-on-surface-variant">
          The captions of {view.voice.toRead} of its best videos have not been read yet.
          <button type="button" disabled={busy} onClick={script.readVoice} className={QUIET_BUTTON}>
            Read its captions
          </button>
        </p>
      )}
      <p className="text-body-sm text-outline">
        {shorts
          ? 'A Short is written to under a minute.'
          : range
            ? `The length range, ${clockOf(range.minSeconds)} to ${clockOf(range.maxSeconds)}, is how long the ${range.videos} winning videos of the channels like yours on this map run (the shortest and longest tenth left out); the middle one is ${clockOf(range.typicalSeconds)}.`
            : 'This map has too few winning videos to take a length range from, so type a length in minutes.'}{' '}
        {view.voice && view.voice.frameStudies.length === 0
          ? 'No frame study is stored for this voice channel, so how often its picture changes is not known: picture cues are set where the subject changes, with no cut rate invented. A channel breakdown of the voice channel stores one.'
          : ''}
      </p>
    </div>
  );
}

interface StepProps {
  readonly number: number;
  readonly title: string;
  readonly about: string;
  readonly action: string;
  readonly state: StageState | undefined;
  readonly busy: boolean;
  readonly onRun: () => void;
}

/** The heading of one step, with the button that has an AI write it. */
function Step({ number, title, about, action, state, busy, onRun }: StepProps) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`${PILL} ${state?.done ? 'text-primary-fixed-dim' : 'text-on-surface-variant'}`}
        >
          Step {number}
          {state?.done ? ' · written' : ''}
        </span>
        <h3 className="text-title-md text-on-surface">{title}</h3>
      </div>
      <p className="text-body-sm text-on-surface-variant">{about}</p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy || state === undefined || state.blocked !== null}
          onClick={onRun}
          className={PRIMARY_BUTTON}
        >
          {state?.done ? `${action} again` : action}
        </button>
        {state?.blocked && <span className="text-body-sm text-outline">{state.blocked}</span>}
      </div>
    </div>
  );
}

/** The library hooks the owner can take as models, up to three. */
function Models({ script, view, hooks }: PartProps & { readonly hooks: readonly LibraryHook[] }) {
  const chosen = view.script?.hookModels ?? [];
  const usable = hooks.filter((hook) => hook.text !== null);
  if (usable.length === 0) {
    return (
      <p className="text-body-sm text-on-surface-variant">
        The hook library has not been built for this channel, so the hooks cannot learn from how its
        breakout videos open. Build it under Hook library; the script writer works without it.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <span className={LABEL}>
        Openings to model · {chosen.length} of {MAX_MODELS}. With none chosen, the AI picks three
        from the library itself.
      </span>
      <div className="flex flex-wrap gap-1.5">
        {usable.map((hook) => (
          <button
            key={hook.videoId}
            type="button"
            aria-pressed={chosen.includes(hook.videoId)}
            title={hook.title}
            onClick={() => script.change({ hookModels: toggleModel(chosen, hook.videoId) })}
            className={`max-w-full truncate rounded-full px-3 py-1 text-body-sm transition-colors ${
              chosen.includes(hook.videoId)
                ? 'bg-primary-container font-semibold text-on-primary'
                : 'bg-surface-container-high text-on-surface-variant hover:text-on-surface'
            }`}
          >
            {hook.style ?? 'unnamed'} · {formatScore(hook.score)} · {hook.title}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Step 1: three hooks side by side, the one the owner takes, and the beat sheet. */
function HooksAndBeats({
  script,
  view,
  hooks,
}: PartProps & { readonly hooks: readonly LibraryHook[] }) {
  const stored = view.script;
  if (!stored || stored.hooks.length === 0) return null;
  return (
    <div className="flex flex-col gap-space-md">
      <div className="grid grid-cols-1 gap-space-md xl:grid-cols-3">
        {stored.hooks.map((hook, index) => {
          const model = hooks.find((entry) => entry.videoId === hook.model);
          const lift = liftedFrom(hook.text, hooks);
          return (
            <div
              key={`${index}-${hook.way}`}
              className="flex min-w-0 flex-col gap-2 rounded bg-space-deep p-space-md"
            >
              <span className={`${PILL} self-start uppercase text-primary-fixed-dim`}>
                {hook.way}
              </span>
              <p className="whitespace-pre-line break-words text-body-sm text-on-surface">
                {hook.text}
              </p>
              {model && (
                <p className="text-body-sm text-outline">
                  Learns from{' '}
                  <a href={`#hook-${model.videoId}`} className="text-primary hover:underline">
                    {model.title}
                  </a>
                  : its way of opening, never its words.
                </p>
              )}
              {lift && (
                <p role="note" className="break-words text-body-sm text-metric-amber">
                  Shares {lift.words} words in a row with a hook in the library: &ldquo;
                  {lift.phrase}
                  &rdquo;. Reword it.
                </p>
              )}
              <button
                type="button"
                aria-pressed={stored.chosenHook === hook.text}
                onClick={() => script.change({ chosenHook: hook.text })}
                className={`self-start ${QUIET_BUTTON}`}
              >
                {stored.chosenHook === hook.text ? 'This is the hook' : 'Use this hook'}
              </button>
            </div>
          );
        })}
      </div>
      <label className="flex min-w-0 flex-col gap-1">
        <span className={LABEL}>The hook you chose (you can edit it)</span>
        <textarea
          value={stored.chosenHook}
          onChange={(event) => script.change({ chosenHook: event.target.value })}
          rows={6}
          className={AREA}
        />
      </label>
      <label className="flex min-w-0 flex-col gap-1">
        <span className={LABEL}>
          Beat sheet (you can edit it): one beat to a line, as time | name | what happens
        </span>
        <textarea
          value={stored.beats}
          onChange={(event) => script.change({ beats: event.target.value })}
          rows={10}
          className={AREA}
        />
      </label>
    </div>
  );
}

const WORKING: Readonly<Record<ScriptStage, string>> = {
  hooks: 'Write the hooks and the beat sheet',
  draft: 'Write the draft',
  tighten: 'Tighten it',
};

interface Props {
  readonly script: Script;
  readonly lab: Lab;
  /** An AI run is under way somewhere on the page. */
  readonly busy: boolean;
  /** The channels of this map a script can be written in the voice of. */
  readonly voices: readonly VoiceChoice[];
}

/**
 * The script writer: one kept concept taken to a script in three steps, with
 * everything about the text counted in code beside it. Opened by a concept's
 * Draft button in the idea lab.
 */
export function ScriptWriter({ script, lab, busy, voices }: Props) {
  const [which, setWhich] = useState<'draft' | 'tightened'>('draft');
  const { view } = script;
  const hooks = lab.library?.hooks ?? [];
  const states = stageStates(view?.script ?? null);
  const stateOf = (stage: ScriptStage) => states.find((state) => state.stage === stage);
  const shown = which === 'tightened' && view?.script?.tightened ? 'tightened' : 'draft';
  const thumbnail = view ? thumbnailFor(lab.thumbnails, view.concept.id) : null;
  return (
    <section
      id="script-writer"
      aria-labelledby="script-writer-title"
      className="w-full scroll-mt-16 bg-space-deep px-gutter-desktop pb-space-xl"
    >
      <div className="mx-auto flex max-w-[1440px] flex-col gap-space-lg">
        <div>
          <div className="flex items-center gap-2">
            <PenLine aria-hidden="true" className="h-[22px] w-[22px] flex-none text-metric-amber" />
            <h2
              id="script-writer-title"
              className="text-headline-lg font-bold tracking-tight text-on-surface"
            >
              Script writer
            </h2>
          </div>
          <p className="mt-1 max-w-4xl text-body-md text-on-surface-variant">
            Takes one kept concept to a script in three steps: hooks and a beat sheet, the draft,
            and a tighten pass. An AI writes it from memory, and some facts may be wrong.
            {(view?.markFacts ?? true) &&
              ' Every fact it could not vouch for is followed by [CHECK: what to verify]. Check each one yourself before you record: a video that states invented facts as true breaks YouTube’s rules on misleading content.'}
          </p>
        </div>

        {script.problem && (
          <p role="alert" className="rounded bg-surface-card p-space-lg text-body-md text-error">
            {script.problem}
          </p>
        )}
        {!view && (
          <p className={NOTE}>
            No script is open. Press Draft on a concept in the idea lab to start its script, or to
            come back to it.
          </p>
        )}
        {view && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="min-w-0 break-words text-headline-md text-on-surface">
                {view.concept.title}
              </h3>
              <span role="status" className="text-body-sm text-outline">
                {script.saving === 'saving'
                  ? 'Saving…'
                  : script.saving === 'failed'
                    ? 'Not saved'
                    : 'Saved on this computer'}
              </span>
            </div>
            <Setup script={script} view={view} busy={busy} voices={voices} />
            <LabStatus
              state={lab.jobs.state}
              kinds={['script-hooks', 'script-draft', 'script-tighten', 'voice-read', 'thumbnail']}
              working="Working on the script"
              takes="A step takes one to six minutes and uses some of the AI’s plan allowance. Keep this page open."
            />

            <div className={CARD}>
              <Step
                number={1}
                title="Hooks and beat sheet"
                about={`Three hooks of about ${view.plan.hookSeconds} seconds each at this voice’s rate (${view.plan.hookWords ?? '—'} words), each opening in a different way, then a beat sheet for the rest.`}
                action={WORKING.hooks}
                state={stateOf('hooks')}
                busy={busy}
                onRun={() => script.runStage('hooks')}
              />
              <Models script={script} view={view} busy={busy} hooks={hooks} />
              <HooksAndBeats script={script} view={view} busy={busy} hooks={hooks} />
            </div>

            <div className={CARD}>
              <Step
                number={2}
                title="The draft"
                about={`The full script for the hook and the beats above: about ${view.plan.targetWords ?? '—'} words, with a picture cue before the words it covers.`}
                action={WORKING.draft}
                state={stateOf('draft')}
                busy={busy}
                onRun={() => script.runStage('draft')}
              />
              <Step
                number={3}
                title="Tighten pass"
                about="The same script made easier to say and to follow, toward the voice channel’s own reading grade, with no fact added."
                action={WORKING.tighten}
                state={stateOf('tighten')}
                busy={busy}
                onRun={() => {
                  setWhich('tightened');
                  script.runStage('tighten');
                }}
              />
              <div
                role="radiogroup"
                aria-label="Which text to edit"
                className="flex flex-wrap gap-2"
              >
                {(['draft', 'tightened'] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    role="radio"
                    aria-checked={shown === option}
                    disabled={option === 'tightened' && !view.script?.tightened}
                    onClick={() => setWhich(option)}
                    className={`rounded-full px-3 py-1 text-body-sm font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-60 ${
                      shown === option
                        ? 'bg-primary-container text-space-deep'
                        : 'bg-surface-container-high text-on-surface-variant hover:text-on-surface'
                    }`}
                  >
                    {option === 'draft' ? 'Draft' : 'Tightened'}
                  </button>
                ))}
              </div>
              <ScriptEditor
                view={view}
                which={shown}
                onChange={(text) =>
                  script.change(shown === 'draft' ? { draft: text } : { tightened: text })
                }
                thumbnailPrompt={thumbnail?.prompt ?? null}
              />
              <ConceptThumbnail
                title={view.concept.title}
                thumbnail={thumbnail}
                busy={busy}
                onWrite={() => lab.writeThumbnail(view.concept.id)}
              />
            </div>
          </>
        )}
      </div>
    </section>
  );
}
