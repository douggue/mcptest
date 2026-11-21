import { useEffect, useState } from 'react';
import {
  type BreakdownOutcome,
  type ChannelChoice,
  groupChoices,
  restsOn,
  SLOW_NOTE,
  studiedLines,
  type VideoToSupply,
} from '../lib/breakdown';
import { runLines } from '../lib/breakdownParts';
import { BreakdownParts } from './BreakdownParts';
import { SupplyVideos, type SendVideo } from './SupplyVideos';
import type { Breakdown, BreakdownChannel } from './useBreakdown';

const NOTE = 'rounded bg-surface-card p-space-lg text-body-md text-on-surface-variant';
const BUTTON =
  'self-start rounded-full bg-on-surface px-4 py-1.5 text-body-sm font-semibold text-space-deep transition-all hover:bg-white disabled:cursor-not-allowed disabled:opacity-60';

interface CardProps {
  /** The channels the owner can pick: from the map on screen, their other saved channels, and the niche lists. */
  readonly choices: readonly ChannelChoice[];
  /** The channel picked so far; null until one is. */
  readonly picked: BreakdownChannel | null;
  /** Picks a channel, so that its stored breakdown is shown. */
  readonly onPick: (channel: BreakdownChannel) => void;
  /** Something is running (a breakdown or an analysis), so nothing new can start. */
  readonly busy: boolean;
  /** A breakdown is the thing running. */
  readonly active: boolean;
  readonly onRun: (channel: BreakdownChannel, fresh: boolean) => void;
}

/** The fourth card of Ask AI: pick a channel and have it taken apart. */
export function BreakdownCard({ choices, picked, onPick, busy, active, onRun }: CardProps) {
  const [fresh, setFresh] = useState(false);
  // The map can change under the card; a pick that is no longer offered falls back to the first.
  const chosen = choices.find((choice) => choice.id === picked?.id) ?? choices[0];
  const chosenId = chosen?.id;
  const chosenTitle = chosen?.title;
  useEffect(() => {
    if (chosenId !== undefined && chosenTitle !== undefined && chosenId !== picked?.id) {
      onPick({ id: chosenId, title: chosenTitle });
    }
  }, [chosenId, chosenTitle, picked?.id, onPick]);
  const choose = (id: string): void => {
    const next = choices.find((choice) => choice.id === id);
    if (next) onPick({ id: next.id, title: next.title });
  };

  return (
    <div className="flex min-w-0 flex-col justify-between gap-space-md rounded bg-surface-card p-space-md shadow-md">
      <div>
        <h3 className="text-title-md text-on-surface">Channel breakdown</h3>
        <p className="mt-1 text-body-sm text-on-surface-variant">
          Takes one channel apart, from this map, your other saved channels or the niche lists, in
          seven parts: its titles, thumbnails, scripts, picture and sound, its strengths and
          weaknesses with a strategy to beat it, a production plan and a master prompt. Each is kept
          and saved as a text file.
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
          onChange={(event) => choose(event.target.value)}
          disabled={busy}
          className="w-full min-w-0 rounded-full bg-space-deep px-4 py-2 text-body-sm text-on-surface shadow-[inset_0_2px_6px_rgba(0,0,0,0.6)] focus:outline-none focus-visible:ring-1 focus-visible:ring-primary-container disabled:opacity-60"
        >
          {groupChoices(choices).map((group) => (
            <optgroup key={group.label} label={group.label}>
              {group.choices.map((choice) => (
                <option key={choice.id} value={choice.id}>
                  {choice.label}
                </option>
              ))}
            </optgroup>
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
  readonly breakdown: Breakdown;
  readonly busy: boolean;
  readonly onSend: SendVideo;
  /** Runs the breakdown of a channel again; `fresh` studies and writes everything again. */
  readonly onRun: (channel: BreakdownChannel, fresh: boolean) => void;
}

interface SupplyProps extends Pick<StatusProps, 'busy' | 'onSend' | 'onRun'> {
  readonly videos: readonly VideoToSupply[];
  readonly folder: string | null;
  readonly channel: BreakdownChannel;
}

/** The videos to give a file for, and the press that picks the files up. */
function Supply({ videos, folder, channel, busy, onSend, onRun }: SupplyProps) {
  if (videos.length === 0) return null;
  return (
    <div className="flex flex-col gap-space-sm">
      <SupplyVideos videos={videos} folder={folder} onSend={onSend} />
      <button
        type="button"
        onClick={() => onRun(channel, false)}
        disabled={busy}
        className={BUTTON}
      >
        Run the breakdown again
      </button>
    </div>
  );
}

interface ResultProps extends Pick<StatusProps, 'busy' | 'onSend' | 'onRun'> {
  readonly outcome: BreakdownOutcome;
  readonly channel: BreakdownChannel;
}

/** A breakdown that has just finished: its parts, then how the run went and what could be deeper. */
function Result({ outcome, channel, busy, onSend, onRun }: ResultProps) {
  const lines = [restsOn(outcome), ...runLines(outcome.parts), ...studiedLines(outcome)];
  return (
    <div className="flex min-w-0 flex-col gap-space-sm">
      <BreakdownParts
        view={outcome.breakdown}
        notSaved={outcome.notSaved}
        busy={busy}
        onRun={onRun}
      />
      <div className="flex flex-col gap-1 text-body-sm text-outline">
        <h4 className="text-label-caps uppercase text-outline">How this run went</h4>
        {lines.map((line) => (
          <p key={line} className="break-words">
            {line}
          </p>
        ))}
      </div>
      <Supply
        videos={outcome.supply}
        folder={outcome.ownVideosFolder}
        channel={channel}
        {...{ busy, onSend, onRun }}
      />
    </div>
  );
}

/**
 * What a breakdown is doing, or what it found. While one runs: the step in
 * words. Otherwise, for the channel that is picked: the breakdown that has
 * just finished, or the one kept from before, with the control to run it again.
 */
export function BreakdownStatus({ breakdown, busy, onSend, onRun }: StatusProps) {
  const { state, picked, stored } = breakdown;
  if (state.status === 'running') {
    return (
      <div className="flex flex-col gap-space-sm">
        <p role="status" className={`flex items-center gap-2 ${NOTE}`}>
          <span className="h-2 w-2 flex-none animate-pulse rounded-full bg-primary-container shadow-[0_0_8px_#00d2ff]" />
          <span className="min-w-0 break-words">
            Breaking down {state.channel.title}. {state.progress?.text ?? 'Starting'}.
          </span>
        </p>
        <SupplyVideos videos={state.progress?.supply ?? []} folder={null} onSend={onSend} />
      </div>
    );
  }
  const ofPicked = state.status !== 'idle' && state.channel.id === picked?.id;
  if (state.status === 'done' && ofPicked) {
    return <Result outcome={state.outcome} channel={state.channel} {...{ busy, onSend, onRun }} />;
  }
  const kept =
    stored.status === 'ready' ? (
      <BreakdownParts view={stored.view} notSaved={null} busy={busy} onRun={onRun} />
    ) : null;
  if (state.status === 'failed' && ofPicked) {
    return (
      <div className="flex min-w-0 flex-col gap-space-sm">
        <p role="alert" className="rounded bg-surface-card p-space-lg text-body-md text-error">
          The breakdown of {state.channel.title} did not finish: {state.message}
        </p>
        <Supply
          videos={state.supply}
          folder={null}
          channel={state.channel}
          {...{ busy, onSend, onRun }}
        />
        {kept}
      </div>
    );
  }
  if (stored.status === 'failed') {
    return (
      <p role="alert" className="rounded bg-surface-card p-space-lg text-body-md text-error">
        The stored breakdown could not be read: {stored.message}
      </p>
    );
  }
  return kept;
}
