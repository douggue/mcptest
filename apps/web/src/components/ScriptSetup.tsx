import { SCRIPT_STATUSES } from '@jgtube/core/src/script/types';
import { clockOf, voiceNote, type ScriptView, type VoiceChoice } from '../lib/scriptWriter';
import { Field } from './layout/Card';
import { Details } from './layout/Details';
import { FIELD, QUIET_BUTTON } from './LabStatus';
import { ScriptLengthFields } from './ScriptLengthFields';
import type { ScriptPartProps } from './ScriptHooks';
import type { Script } from './useScript';

const STATUS_NAMES = { idea: 'Idea', drafting: 'Drafting', ready: 'Ready' } as const;

/** Where the script stands, as a compact list for the top bar. */
export function StatusSelect({
  script,
  view,
}: {
  readonly script: Script;
  readonly view: ScriptView;
}) {
  const stored = view.script;
  if (!stored) return null;
  return (
    <label className="flex items-center gap-2">
      <span className="text-label-caps uppercase text-outline">Status</span>
      <select
        value={stored.status}
        onChange={(event) =>
          script.change({
            status: SCRIPT_STATUSES.find((status) => status === event.target.value) ?? 'idea',
          })
        }
        className={FIELD.replace('w-full', 'w-auto')}
      >
        {SCRIPT_STATUSES.map((status) => (
          <option key={status} value={status}>
            {STATUS_NAMES[status]}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Where the suggested length comes from, and what is not known about the voice's pictures. */
function lengthNote(view: ScriptView): string {
  const range = view.lengthRange;
  const length =
    view.concept.length === 'shorts'
      ? 'A Short is written to under a minute.'
      : range
        ? `Suggested: the ${range.videos} winning videos of the channels like yours on this map run ${clockOf(range.minSeconds)} to ${clockOf(range.maxSeconds)} (the shortest and longest tenth left out); the middle one is ${clockOf(range.typicalSeconds)}. Type any length: minutes and words stay in step through the words a minute.`
        : 'This map has too few winning videos to suggest a length, so type one in minutes or words.';
  const frames =
    view.voice && view.voice.frameStudies.length === 0
      ? ' No frame study is stored for this voice channel, so how often its picture changes is not known: picture cues are set where the subject changes, with no cut rate invented. A channel breakdown of the voice channel stores one.'
      : '';
  return `${length}${frames}`;
}

/** The voice, rate and length the script is written to, for the side panel. */
export function ScriptSetup({
  script,
  view,
  busy,
  voices,
}: ScriptPartProps & { readonly voices: readonly VoiceChoice[] }) {
  const stored = view.script;
  if (!stored) return null;
  return (
    <>
      <Field label="Voice: write it the way this channel speaks">
        <select
          aria-label="Voice"
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
        <p className="rounded-lg border border-border-subtle bg-space-deep p-space-sm text-body-sm text-on-surface-variant">
          {voiceNote(view.voice)}
        </p>
        {view.voice && view.voice.toRead > 0 && (
          <div className="flex flex-col items-start gap-1.5 text-body-sm text-on-surface-variant">
            The captions of {view.voice.toRead} of its best videos have not been read yet.
            <button
              type="button"
              disabled={busy}
              onClick={script.readVoice}
              className={QUIET_BUTTON}
            >
              Read its captions
            </button>
          </div>
        )}
      </Field>
      <Field label="Words a minute">
        <input
          type="number"
          aria-label="Words a minute"
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
      </Field>
      <ScriptLengthFields script={script} view={view} />
      <Details summary="Where the length comes from">
        <p className="text-body-sm text-on-surface-variant">{lengthNote(view)}</p>
      </Details>
    </>
  );
}
