import type { SavedChannel } from '@jgtube/core';
import { X } from 'lucide-react';
import { useState } from 'react';
import { badgeText } from '../lib/alerts';
import { formatCount } from '../lib/format';
import { ChannelLogo } from './ChannelLogo';
import { Card, Label } from './layout/Card';

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
}

/** What a row says under the name: on screen or not, subscribers, and the map's size. */
function rowLine(channel: SavedChannel): string {
  const parts = [
    channel.subscribers === null ? null : `${formatCount(channel.subscribers)} subscribers`,
    `${channel.channelCount} channels on its map`,
  ];
  return parts.filter((part) => part !== null).join(' · ');
}

/** One saved channel: press it to open its map and its view, the cross to delete it. */
function Row({ channel, current, busy, onOpen, onAskDelete, unread }: RowProps) {
  const badge = badgeText(unread);
  return (
    <li className="flex min-w-0 items-center gap-space-sm py-1.5">
      <button
        type="button"
        aria-current={current ? 'true' : undefined}
        disabled={busy}
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center gap-space-sm rounded-lg p-1 text-left transition-colors hover:bg-surface-container disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span
          className={`flex h-11 w-11 flex-none items-center justify-center overflow-hidden rounded-full bg-surface-container-high text-body-sm font-bold text-secondary ring-2 ${
            current ? 'ring-primary-container' : 'ring-border-subtle'
          }`}
        >
          <ChannelLogo title={channel.title} logoUrl={channel.logoUrl} />
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-body-md text-on-surface">{channel.title}</span>
            {badge && (
              <span
                aria-label={`${unread} new alert${unread === 1 ? '' : 's'}`}
                className="flex-none rounded-full bg-metric-amber-bg px-1.5 text-label font-semibold text-metric-amber"
              >
                {badge}
              </span>
            )}
          </span>
          <span className="truncate text-body-sm">
            {current && <span className="text-primary">On screen · </span>}
            <span className="text-on-surface-variant">{rowLine(channel)}</span>
          </span>
        </span>
      </button>
      <button
        type="button"
        aria-label={`Delete ${channel.title} from your channels`}
        disabled={busy}
        onClick={onAskDelete}
        className="flex h-10 w-10 flex-none items-center justify-center rounded-full text-outline transition-colors hover:bg-surface-container hover:text-on-surface disabled:cursor-not-allowed disabled:opacity-60"
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
export function SavedChannels({ channels, currentId, busy, onOpen, onDelete, badges }: Props) {
  const [askingId, setAskingId] = useState<string | null>(null);
  if (channels.length === 0) return null;
  return (
    <nav aria-label="Your channels">
      <Card>
        <Label>Your channels ({channels.length})</Label>
        <ul className="flex flex-col divide-y divide-border-subtle">
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
              />
            ),
          )}
        </ul>
      </Card>
    </nav>
  );
}
