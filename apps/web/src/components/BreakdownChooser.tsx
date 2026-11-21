import { useEffect } from 'react';
import { type ChannelChoice, groupChoices } from '../lib/breakdown';
import { Field } from './layout/Card';
import { FIELD } from './LabStatus';
import type { BreakdownChannel } from './useBreakdown';

interface Props {
  /** The channels the owner can pick: from the map on screen, their other saved channels, and the niche lists. */
  readonly choices: readonly ChannelChoice[];
  /** The channel picked so far; null until one is. */
  readonly picked: BreakdownChannel | null;
  /** Picks a channel, so that its stored breakdown is shown. */
  readonly onPick: (channel: BreakdownChannel) => void;
  /** Something is running (a breakdown or an analysis), so nothing new can start. */
  readonly busy: boolean;
  /** Whether the next run studies and writes everything again. */
  readonly fresh: boolean;
  readonly onFresh: (fresh: boolean) => void;
}

/** The channel offered for a breakdown: the one picked, or the first when the pick is no longer offered. */
export function chosenOf(
  choices: readonly ChannelChoice[],
  picked: BreakdownChannel | null,
): ChannelChoice | undefined {
  return choices.find((choice) => choice.id === picked?.id) ?? choices[0];
}

/** Which channel to break down, and whether to start again from nothing. */
export function BreakdownChooser({ choices, picked, onPick, busy, fresh, onFresh }: Props) {
  // The map can change under the panel; a pick that is no longer offered falls back to the first.
  const chosen = chosenOf(choices, picked);
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
    <Field label={<label htmlFor="breakdown-channel">Channel to break down</label>}>
      <select
        id="breakdown-channel"
        value={chosen?.id ?? ''}
        onChange={(event) => choose(event.target.value)}
        disabled={busy}
        className={FIELD}
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
          onChange={(event) => onFresh(event.target.checked)}
          disabled={busy}
          className="h-4 w-4 accent-primary-container"
        />
        Start again from nothing
      </label>
    </Field>
  );
}
