import { useState } from 'react';
import {
  SLOW_NOTE,
  restsOn,
  studiedLines,
  type ChannelChoice,
  type VideoToSupply,
} from '../lib/breakdown';
import { Answer, Credit } from './Answer';
import { SupplyVideos, type SendVideo } from './SupplyVideos';
import type { BreakdownChannel, BreakdownState } from './useBreakdown';

const NOTE = 'rounded bg-surface-card p-space-lg text-body-md text-on-surface-variant';
const BUTTON =
  'self-start rounded-full bg-on-surface px-4 py-1.5 text-body-sm font-semibold text-space-deep transition-all hover:bg-white disabled:cursor-not-allowed disabled:opacity-60';

interface CardProps {
  /** The channels the owner can pick: the model, their own, and the look-alikes on the map. */
  readonly choices: readonly ChannelChoice[];
  /** Something is running (a breakdown or an analysis), so nothing new can start. */
  readonly busy: boolean;
  /** A breakdown is the thing running. */
  readonly active: boolean;
  readonly onRun: (channel: BreakdownChannel, fresh: boolean) => void;
}

/** The fourth card of Ask AI: pick a channel and have it taken apart. */
export function BreakdownCard({ choices, busy, active, onRun }: CardProps) {
  const [chosenId, setChosenId] = useState('');
  const [fresh, setFresh] = useState(false);
  // The map can change under the card; a choice that is no longer on it falls back to the first.
  const chosen = choices.find((choice) => choice.id === chosenId) ?? choices[0];

  return (
    <div className="flex min-w-0 flex-col justify-between gap-space-md rounded bg-surface-card p-space-md shadow-md">
      <div>
        <h3 className="text-title-md text-on-surface">Channel breakdown</h3>
        <p className="mt-1 text-body-sm text-on-surface-variant">
          Takes one channel apart: its identity, title formula, thumbnails, descriptions, scripts,
          pictures frame by frame, sound and editing, and how to make a video like its best ones.
        </p>
        <p className="mt-1 text-body-sm text-outline">{SLOW_NOTE}</p>
      </div>
      <div className="flex min-w-0 flex-col gap-2">
        <label htmlFor="breakdown-channel" className="text-label-caps uppercase text-outline">
          Channel to break down
        </label>
        <select
          id="breakdown-channel"
          value={chosen?.id ?? ''}
          onChange={(event) => setChosenId(event.target.value)}
          disabled={busy}
          className="w-full min-w-0 rounded-full bg-space-deep px-4 py-2 text-body-sm text-on-surface shadow-[inset_0_2px_6px_rgba(0,0,0,0.6)] focus:outline-none focus-visible:ring-1 focus-visible:ring-primary-container disabled:opacity-60"
        >
          {choices.map((choice) => (
            <option key={choice.id} value={choice.id}>
              {choice.label}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-body-sm text-on-surface-variant">
          <input
            type="checkbox"
            checked={fresh}
            onChange={(event) => setFresh(event.target.checked)}
            disabled={busy}
            className="h-4 w-4 accent-primary-container"
          />
          Start again from nothing
        </label>
        <button
          type="button"
          onClick={() => chosen && onRun({ id: chosen.id, title: chosen.title }, fresh)}
          disabled={busy || !chosen}
          className={BUTTON}
        >
          {active ? 'Working…' : 'Break down this channel'}
        </button>
      </div>
    </div>
  );
}

interface StatusProps {
  readonly state: BreakdownState;
  readonly busy: boolean;
  readonly onSend: SendVideo;
  /** Runs the breakdown of the same channel again, reusing what is stored. */
  readonly onAgain: (channel: BreakdownChannel) => void;
}

interface SupplyProps extends Pick<StatusProps, 'busy' | 'onSend' | 'onAgain'> {
  readonly videos: readonly VideoToSupply[];
  readonly folder: string | null;
  readonly channel: BreakdownChannel;
}

/** The videos to give a file for, and the press that picks the files up. */
function Supply({ videos, folder, channel, busy, onSend, onAgain }: SupplyProps) {
  if (videos.length === 0) return null;
  return (
    <div className="flex flex-col gap-space-sm">
      <SupplyVideos videos={videos} folder={folder} onSend={onSend} />
      <button type="button" onClick={() => onAgain(channel)} disabled={busy} className={BUTTON}>
        Run the breakdown again
      </button>
    </div>
  );
}

/** What a breakdown is doing, or what it found: the step in words, then the answer and how each video went. */
export function BreakdownStatus({ state, busy, onSend, onAgain }: StatusProps) {
  if (state.status === 'idle') return null;
  const { channel } = state;
  if (state.status === 'running') {
    return (
      <div className="flex flex-col gap-space-sm">
        <p role="status" className={`flex items-center gap-2 ${NOTE}`}>
          <span className="h-2 w-2 flex-none animate-pulse rounded-full bg-primary-container shadow-[0_0_8px_#00d2ff]" />
          <span className="min-w-0 break-words">
            Breaking down {channel.title}. {state.progress?.text ?? 'Starting'}.
          </span>
        </p>
        <SupplyVideos videos={state.progress?.supply ?? []} folder={null} onSend={onSend} />
      </div>
    );
  }
  if (state.status === 'failed') {
    return (
      <div className="flex flex-col gap-space-sm">
        <p role="alert" className="rounded bg-surface-card p-space-lg text-body-md text-error">
          The breakdown of {channel.title} did not finish: {state.message}
        </p>
        <Supply
          videos={state.supply}
          folder={null}
          channel={channel}
          {...{ busy, onSend, onAgain }}
        />
      </div>
    );
  }
  const { outcome } = state;
  return (
    <div className="flex min-w-0 flex-col gap-space-sm">
      <h3 className="text-title-md text-on-surface">Channel breakdown: {outcome.channel.title}</h3>
      <p className="text-body-sm text-on-surface-variant">{restsOn(outcome)}</p>
      <Answer text={outcome.text} />
      <Credit answer={outcome} />
      <div className="flex flex-col gap-1 text-body-sm text-outline">
        {studiedLines(outcome).map((line) => (
          <p key={line} className="break-words">
            {line}
          </p>
        ))}
      </div>
      <Supply
        videos={outcome.supply}
        folder={outcome.ownVideosFolder}
        channel={channel}
        {...{ busy, onSend, onAgain }}
      />
    </div>
  );
}
