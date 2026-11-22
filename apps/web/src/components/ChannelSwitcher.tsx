import type { SavedChannel } from '@jgtube/core';
import { Check, ChevronDown } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { ChannelLogo } from './ChannelLogo';

interface Props {
  readonly channels: readonly SavedChannel[];
  /** The channel whose map is on screen; null before any. */
  readonly currentId: string | null;
  /** A map is being made: switching waits until it is done. */
  readonly busy: boolean;
  readonly onOpen: (channel: SavedChannel) => void;
}

/**
 * Which channel the app is about, always in view, and the way to switch to
 * another of your channels without going back to Home.
 */
export function ChannelSwitcher({ channels, currentId, busy, onOpen }: Props) {
  const menu = useRef<HTMLDetailsElement>(null);
  // Closes on a press anywhere else, and when another view opens.
  useEffect(() => {
    const close = (event: Event): void => {
      const open = menu.current;
      if (open?.open && !(event.target instanceof Node && open.contains(event.target))) {
        open.open = false;
      }
    };
    document.addEventListener('click', close);
    window.addEventListener('hashchange', close);
    return () => {
      document.removeEventListener('click', close);
      window.removeEventListener('hashchange', close);
    };
  }, []);
  const current = channels.find((channel) => channel.id === currentId);
  if (!current) return null;
  return (
    <details ref={menu} className="group/switch relative min-w-0">
      <summary
        aria-label={`Channel: ${current.title}. Switch channel`}
        className="flex min-h-11 min-w-0 cursor-pointer list-none items-center gap-2 rounded-full px-2 text-body-md text-on-surface transition-colors hover:bg-surface-card focus:outline-none focus-visible:ring-1 focus-visible:ring-primary-container [&::-webkit-details-marker]:hidden"
      >
        <span className="flex h-8 w-8 flex-none items-center justify-center overflow-hidden rounded-full bg-surface-container-high text-body-sm font-bold text-secondary">
          <ChannelLogo title={current.title} logoUrl={current.logoUrl} letters={1} />
        </span>
        <span className="hidden max-w-[12rem] truncate font-semibold sm:inline">
          {current.title}
        </span>
        <ChevronDown
          aria-hidden="true"
          className="h-4 w-4 flex-none text-outline transition-transform group-open/switch:rotate-180"
        />
      </summary>
      <ul className="absolute left-0 top-full z-50 mt-2 flex w-72 max-w-[calc(100vw-2rem)] flex-col rounded-lg border border-border-subtle bg-surface-card p-1 shadow-2xl">
        {channels.map((channel) => (
          <li key={channel.id}>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (menu.current) menu.current.open = false;
                onOpen(channel);
              }}
              className="flex min-h-11 w-full items-center gap-2 rounded px-2 text-left text-body-md text-on-surface hover:bg-surface-container-high disabled:opacity-60"
            >
              <span className="flex h-7 w-7 flex-none items-center justify-center overflow-hidden rounded-full bg-surface-container-high text-body-sm font-bold text-secondary">
                <ChannelLogo title={channel.title} logoUrl={channel.logoUrl} letters={1} />
              </span>
              <span className="min-w-0 flex-1 truncate">{channel.title}</span>
              {channel.id === currentId && (
                <Check aria-label="Open now" className="h-4 w-4 flex-none text-primary" />
              )}
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}
