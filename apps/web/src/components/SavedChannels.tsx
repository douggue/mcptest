import type { SavedChannel } from '@jgtube/core';
import { X } from 'lucide-react';
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
  /** Unread alerts per channel id, shown as a count on its chip. */
  readonly badges?: Readonly<Record<string, number>>;
}

const CHIP = 'flex max-w-full items-center gap-1 rounded-full py-1 pl-1 pr-1 text-body-sm';
const SMALL_BUTTON =
  'rounded-full px-2.5 py-1 text-label-caps transition-colors disabled:cursor-not-allowed disabled:opacity-60';

interface ChipProps {
  readonly channel: SavedChannel;
  readonly current: boolean;
  readonly busy: boolean;
  readonly onOpen: () => void;
  readonly onAskDelete: () => void;
  readonly unread: number;
}

/** One saved channel: press its name to open its map, the cross to delete it. */
function Chip({ channel, current, busy, onOpen, onAskDelete, unread }: ChipProps) {
  const badge = badgeText(unread);
  return (
    <div
      className={`${CHIP} ${
        current
          ? 'bg-surface-card text-on-surface ring-1 ring-primary-container'
          : 'bg-surface-container text-on-surface-variant'
      }`}
    >
      <button
        type="button"
        aria-current={current ? 'true' : undefined}
        disabled={busy}
        onClick={onOpen}
        title={`${channel.title}: ${channel.channelCount} channels on its map`}
        className={`flex min-w-0 items-center gap-2 rounded-full pr-1 transition-colors hover:text-on-surface disabled:cursor-not-allowed disabled:opacity-60 ${
          current ? 'font-semibold' : ''
        }`}
      >
        <span className="flex h-7 w-7 flex-none items-center justify-center overflow-hidden rounded-full bg-space-deep text-xs font-bold text-secondary">
          <ChannelLogo title={channel.title} logoUrl={channel.logoUrl} letters={1} />
        </span>
        <span className="truncate">{channel.title}</span>
        {channel.subscribers !== null && (
          <span className="flex-none text-label-caps text-outline">
            {formatCount(channel.subscribers)}
          </span>
        )}
        {badge && (
          <span
            aria-label={`${unread} new alert${unread === 1 ? '' : 's'}`}
            className="flex-none rounded-full bg-metric-amber-bg px-1.5 text-label-caps font-semibold text-metric-amber"
          >
            {badge}
          </span>
        )}
      </button>
      <button
        type="button"
        aria-label={`Delete ${channel.title} from your channels`}
        disabled={busy}
        onClick={onAskDelete}
        className="flex h-6 w-6 flex-none items-center justify-center rounded-full text-outline transition-colors hover:bg-surface-variant hover:text-on-surface disabled:cursor-not-allowed disabled:opacity-60"
      >
        <X aria-hidden="true" className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

interface ConfirmProps {
  readonly channel: SavedChannel;
  readonly onDelete: () => void;
  readonly onKeep: () => void;
}

/** Asked before a saved channel is deleted, in the place of its chip. */
function Confirm({ channel, onDelete, onKeep }: ConfirmProps) {
  return (
    <div
      role="group"
      aria-label={`Delete ${channel.title}?`}
      className={`${CHIP} bg-surface-card pl-3 text-on-surface ring-1 ring-error`}
    >
      <span className="truncate">Delete {channel.title} and its map?</span>
      <button
        type="button"
        onClick={onDelete}
        className={`${SMALL_BUTTON} bg-error font-semibold text-space-deep hover:opacity-90`}
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
    </div>
  );
}

/**
 * Every channel a map has been made for, as a row to switch between. Looking
 * up another channel never drops an earlier one: its map stays in the store,
 * and choosing it here shows that map again at once, without reading YouTube.
 * A channel leaves the row only when the owner deletes it, after being asked.
 */
export function SavedChannels({ channels, currentId, busy, onOpen, onDelete, badges }: Props) {
  const [askingId, setAskingId] = useState<string | null>(null);
  if (channels.length === 0) return null;
  return (
    <nav
      aria-label="Your channels"
      className="w-full bg-space-canvas px-gutter-desktop pb-space-md"
    >
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-2">
        <span className="text-label-caps uppercase text-outline">Your channels</span>
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
            <Chip
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
      </div>
    </nav>
  );
}
