import type { SavedChannel } from '@jgtube/core';
import { Check, ChevronDown, Plus } from 'lucide-react';
import { viewHref } from '../lib/routes';
import { useEffect, useRef } from 'react';
import { Avatar } from './ui/Row';

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
 * another of your channels without going back to Today.
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
  if (!current) {
    // No channel yet: the same place in the bar is the way to add the first one.
    return (
      <a
        href={viewHref('home')}
        onClick={() =>
          window.setTimeout(() => document.getElementById('channel-query')?.focus(), 300)
        }
        className="flex h-10 flex-none items-center gap-1.5 rounded-full border border-line px-3 text-[15px] font-medium text-link transition-colors hover:border-line-2"
      >
        <Plus aria-hidden="true" className="h-4 w-4" />
        <span className="hidden sm:inline">Add a channel</span>
        <span className="sm:hidden">Add</span>
      </a>
    );
  }
  return (
    <details ref={menu} className="group/switch relative min-w-0">
      <summary
        aria-label={`Channel: ${current.title}. Switch channel`}
        className="flex h-10 min-w-0 cursor-pointer list-none items-center gap-2 rounded-full border border-transparent px-1 text-[15px] text-ink transition-colors hover:bg-white/[0.06] focus:outline-none focus-visible:ring-2 focus-visible:ring-signal md:border-line md:pl-1.5 md:pr-2.5 [&::-webkit-details-marker]:hidden"
      >
        <Avatar title={current.title} logoUrl={current.logoUrl} size="sm" />
        <span className="hidden max-w-[12rem] truncate font-medium md:inline">{current.title}</span>
        <ChevronDown
          aria-hidden="true"
          className="h-4 w-4 flex-none text-outline transition-transform group-open/switch:rotate-180"
        />
      </summary>
      <ul className="absolute left-0 top-full z-50 mt-2 flex w-72 max-w-[calc(100vw-2rem)] flex-col rounded-lg border border-line bg-card p-1.5 shadow-2xl">
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
              <Avatar title={channel.title} logoUrl={channel.logoUrl} size="sm" />
              <span className="min-w-0 flex-1 truncate">{channel.title}</span>
              {channel.id === currentId && (
                <Check aria-label="Open now" className="h-4 w-4 flex-none text-primary" />
              )}
            </button>
          </li>
        ))}
        <li className="mt-1 border-t border-border-subtle pt-1">
          <a
            href={`${viewHref('home')}`}
            onClick={() => {
              if (menu.current) menu.current.open = false;
              // Today shows the add form; bring it into view once Today is drawn.
              window.setTimeout(() => document.getElementById('channel-query')?.focus(), 300);
            }}
            className="flex min-h-11 w-full items-center gap-2 rounded px-2 text-body-md text-primary hover:bg-surface-container-high"
          >
            <Plus aria-hidden="true" className="h-5 w-5" />
            Add a channel
          </a>
        </li>
      </ul>
    </details>
  );
}
