import type { SavedChannel } from '@jgtube/core';
import { Plus, X } from 'lucide-react';
import { useState } from 'react';
import { badgeText } from '../lib/alerts';
import { formatCount } from '../lib/format';
import { ChannelLogo } from './ChannelLogo';

interface Props {
  readonly channels: readonly SavedChannel[];
  /** The channel whose map is on screen, if any. */
  readonly currentId: string | null;
  /** A map is being made; switching and deleting wait until it is done. */
  readonly busy: boolean;
  readonly onOpen: (channel: SavedChannel) => void;
  readonly onDelete: (channel: SavedChannel) => void;
  /** Unread alerts per channel id, shown as a count on its row. */
  readonly badges?: Readonly<Record<string, number>>;
  /** How many videos are breaking out on the map on screen, for its card. */
  readonly breakouts?: number | null;
}

const ADD_BUTTON =
  'flex min-h-11 items-center gap-1.5 rounded-full px-3 text-body-sm font-semibold text-on-surface-variant transition-colors hover:bg-surface-card hover:text-on-surface';

/** Takes the owner to the search for competitors, where a channel is added. */
function focusSearch(): void {
  const input = document.getElementById('channel-query');
  if (!(input instanceof HTMLInputElement)) return;
  input.scrollIntoView({ block: 'center' });
  input.focus();
  input.select();
}

const SMALL_BUTTON =
  'min-h-9 rounded-full px-3 text-body-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60';

interface RowProps {
  readonly channel: SavedChannel;
  readonly current: boolean;
  readonly busy: boolean;
  readonly onOpen: () => void;
  readonly onAskDelete: () => void;
  readonly unread: number;
  /** How many videos are breaking out on the map on screen; shown on its card only. */
  readonly breakouts: number | null;
}

/** What a card says under the name: subscribers and the map's size, or what is breaking out on screen. */
function cardLine(channel: SavedChannel, breakouts: number | null): string {
  const parts = [
    breakouts === null ? null : `${breakouts} breaking out`,
    channel.subscribers === null ? null : `${formatCount(channel.subscribers)} subscribers`,
    breakouts === null ? `${channel.channelCount} channels on its map` : null,
  ];
  return parts.filter((part) => part !== null).join(' · ');
}

/** One saved channel as a card: press it to open its map and its page, the cross to delete it. */
function Row({ channel, current, busy, onOpen, onAskDelete, unread, breakouts }: RowProps) {
  const badge = badgeText(unread);
  return (
    <li
      className={`relative flex min-w-0 items-center rounded-lg border bg-surface-card ${
        current ? 'border-border-highlight' : 'border-border-subtle'
      }`}
    >
      <button
        type="button"
        aria-current={current ? 'true' : undefined}
        disabled={busy}
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center gap-space-md rounded-lg p-space-md pr-14 text-left transition-colors hover:bg-surface-container disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span className="flex h-14 w-14 flex-none items-center justify-center overflow-hidden rounded-full bg-surface-container-high text-title-md font-bold text-secondary">
          <ChannelLogo title={channel.title} logoUrl={channel.logoUrl} />
        </span>
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-title-md text-on-surface">{channel.title}</span>
            {badge && (
              <span
                aria-label={`${unread} new alert${unread === 1 ? '' : 's'}`}
                className="flex-none rounded-full bg-metric-amber-bg px-1.5 text-label font-semibold text-metric-amber"
              >
                {badge}
              </span>
            )}
          </span>
          <span className="truncate text-body-sm text-on-surface-variant">
            {cardLine(channel, current ? breakouts : null)}
          </span>
          {current && <span className="text-body-sm text-primary">Open now</span>}
        </span>
      </button>
      <button
        type="button"
        aria-label={`Delete ${channel.title} from your channels`}
        disabled={busy}
        onClick={onAskDelete}
        className="absolute right-2 top-2 flex h-10 w-10 items-center justify-center rounded-full text-outline transition-colors hover:bg-surface-container hover:text-on-surface disabled:cursor-not-allowed disabled:opacity-60"
      >
        <X aria-hidden="true" className="h-5 w-5" />
      </button>
    </li>
  );
}

interface ConfirmProps {
  readonly channel: SavedChannel;
  readonly onDelete: () => void;
  readonly onKeep: () => void;
}

/** Asked before a saved channel is deleted, in the place of its row. */
function Confirm({ channel, onDelete, onKeep }: ConfirmProps) {
  return (
    <li
      role="group"
      aria-label={`Delete ${channel.title}?`}
      className="flex min-w-0 flex-wrap items-center gap-space-sm rounded-lg bg-surface-container p-space-sm ring-1 ring-error"
    >
      <span className="min-w-0 flex-1 basis-48 text-body-md text-on-surface">
        Delete {channel.title} and its map?
      </span>
      <button
        type="button"
        onClick={onDelete}
        className={`${SMALL_BUTTON} bg-error text-space-deep hover:opacity-90`}
      >
        Delete
      </button>
      <button
        type="button"
        onClick={onKeep}
        className={`${SMALL_BUTTON} bg-surface-container-high text-on-surface hover:bg-surface-variant`}
      >
        Keep
      </button>
    </li>
  );
}

/**
 * Every channel a map has been made for, as a clean list. Looking up another
 * channel never drops an earlier one: its map stays in the store, and
 * choosing it here shows that map again at once, without reading YouTube.
 * A channel leaves the list only when the owner deletes it, after being asked.
 */
export function SavedChannels(props: Props) {
  const { channels, currentId, busy, onOpen, onDelete, badges, breakouts = null } = props;
  const [askingId, setAskingId] = useState<string | null>(null);
  if (channels.length === 0) return null;
  return (
    <nav aria-label="Your channels" className="flex min-w-0 flex-col gap-space-md">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <h3 className="text-headline-md font-bold text-on-surface">Your channels</h3>
        <button type="button" onClick={focusSearch} className={ADD_BUTTON}>
          <Plus aria-hidden="true" className="h-4 w-4" />
          Add a channel
        </button>
      </div>
      <ul className="grid min-w-0 grid-cols-1 gap-space-md xl:grid-cols-2">
        {channels.map((channel) =>
          channel.id === askingId ? (
            <Confirm
              key={channel.id}
              channel={channel}
              onKeep={() => setAskingId(null)}
              onDelete={() => {
                setAskingId(null);
                onDelete(channel);
              }}
            />
          ) : (
            <Row
              key={channel.id}
              channel={channel}
              current={channel.id === currentId}
              busy={busy}
              onOpen={() => onOpen(channel)}
              onAskDelete={() => setAskingId(channel.id)}
              unread={badges?.[channel.id] ?? 0}
              breakouts={breakouts}
            />
          ),
        )}
      </ul>
    </nav>
  );
}
