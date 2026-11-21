import { SCRIPT_STATUSES } from '@jgtube/core/src/script/types';
import { clockOf, voiceNote, type VoiceChoice } from '../lib/scriptWriter';
import { FIELD, QUIET_BUTTON } from './LabStatus';
import { ScriptLengthFields } from './ScriptLengthFields';
import type { ScriptPartProps } from './ScriptHooks';

const LABEL = 'text-label-caps uppercase text-outline';
const CARD = 'flex min-w-0 flex-col gap-space-md rounded bg-surface-card p-space-md shadow-md';
const STATUS_NAMES = { idea: 'Idea', drafting: 'Drafting', ready: 'Ready' } as const;

/** Where the script stands, and the voice, rate and length it is written to. */
export function ScriptSetup({
  script,
  view,
  busy,
  voices,
}: ScriptPartProps & { readonly voices: readonly VoiceChoice[] }) {
  const stored = view.script;
  if (!stored) return null;
  const shorts = view.concept.length === 'shorts';
  const range = view.lengthRange;
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
        <ScriptLengthFields script={script} view={view} />
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
            ? `Suggested: the ${range.videos} winning videos of the channels like yours on this map run ${clockOf(range.minSeconds)} to ${clockOf(range.maxSeconds)} (the shortest and longest tenth left out); the middle one is ${clockOf(range.typicalSeconds)}. Type any length: minutes and words stay in step through the words a minute.`
            : 'This map has too few winning videos to suggest a length, so type one in minutes or words.'}{' '}
        {view.voice && view.voice.frameStudies.length === 0
          ? 'No frame study is stored for this voice channel, so how often its picture changes is not known: picture cues are set where the subject changes, with no cut rate invented. A channel breakdown of the voice channel stores one.'
          : ''}
      </p>
    </div>
  );
}
