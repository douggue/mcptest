import { SCRIPT_STATUSES } from '@jgtube/core/src/script/types';
import { clockOf, voiceNote, type VoiceChoice } from '../lib/scriptWriter';
import { FIELD, QUIET_BUTTON } from './LabStatus';
import type { ScriptPartProps } from './ScriptHooks';

const LABEL = 'text-label-caps uppercase text-outline';
const CARD = 'flex min-w-0 flex-col gap-space-md rounded bg-surface-card p-space-md shadow-md';
const STATUS_NAMES = { idea: 'Idea', drafting: 'Drafting', ready: 'Ready' } as const;
const SECONDS_PER_MINUTE = 60;

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
