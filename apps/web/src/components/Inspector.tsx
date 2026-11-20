import type { SnapshotChannel } from '@jgtube/core';
import { ExternalLink, X } from 'lucide-react';
import { channelUrl, formatCount, formatScore, initials, percent, watchUrl } from '../lib/format';
import { OUTSIDE_LABEL, TIER_LABEL } from './tiers';

interface Props {
  readonly channel: SnapshotChannel;
  readonly onClose: () => void;
  /** Removes the channel from the owner's competitors, or restores it. */
  readonly onSetRemoved: (removed: boolean) => void;
}

function Tile({ label, children }: { readonly label: string; readonly children: React.ReactNode }) {
  return (
    <div className="rounded bg-space-deep p-2.5">
      <span className="block text-label-caps uppercase text-outline">{label}</span>
      {children}
    </div>
  );
}

/** The panel for one selected channel: how it relates to you and how it is doing. */
export function Inspector({ channel, onClose, onSetRemoved }: Props) {
  const link = channelUrl(channel.id);
  const breakoutLink = channel.breakout ? watchUrl(channel.breakout.videoId) : null;
  const topSource = channel.recommendedBy[0];

  return (
    <aside
      aria-label={`Details for ${channel.title}`}
      className="absolute right-6 top-6 z-40 w-80 rounded bg-surface-card/95 p-space-md shadow-[0_8px_32px_rgba(0,0,0,0.7)] backdrop-blur-xl"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-space-sm">
          <div className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-surface-container-high text-body-sm font-bold text-secondary shadow-md">
            {initials(channel.title)}
          </div>
          <div className="min-w-0">
            <span className="block truncate text-headline-md leading-tight text-on-surface">
              {channel.title}
            </span>
            <span className="text-label-caps text-outline">
              {TIER_LABEL[channel.tier]} ·{' '}
              {channel.steps === 1 ? '1 step' : `${channel.steps} steps`}
              {channel.rising ? ' · Rising' : ''}
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close details"
          className="-mr-1 -mt-1 rounded-full p-2 text-outline hover:text-on-surface"
        >
          <X aria-hidden="true" className="h-[18px] w-[18px]" />
        </button>
      </div>

      <div className="mt-space-md grid grid-cols-2 gap-2">
        {channel.centerShare !== null ? (
          <Tile label="Next to your videos">
            <span className="mt-0.5 block text-headline-md font-bold text-primary">
              {percent(channel.centerShare)}
            </span>
          </Tile>
        ) : (
          <Tile label="Reached through">
            <span className="mt-0.5 block truncate text-body-sm font-semibold text-primary">
              {topSource ? topSource.channelTitle : 'Another channel'}
            </span>
          </Tile>
        )}
        <Tile label="Best breakout">
          <span className="mt-0.5 block text-headline-md font-bold text-metric-amber">
            {channel.breakout ? formatScore(channel.breakout.score) : '—'}
          </span>
        </Tile>
      </div>

      <div className="mt-space-sm grid grid-cols-3 gap-2 rounded bg-space-deep p-2.5">
        <div className="flex flex-col">
          <span className="text-label-caps text-outline">Subscribers</span>
          <span className="text-body-sm font-semibold text-on-surface">
            {formatCount(channel.subscribers)}
          </span>
        </div>
        <div className="flex flex-col">
          <span className="text-label-caps text-outline">Title match</span>
          <span className="text-body-sm font-semibold text-secondary">
            {percent(channel.relevance)}
          </span>
        </div>
        <div className="flex flex-col">
          <span className="text-label-caps text-outline">Recent views</span>
          <span className="text-body-sm font-semibold text-on-surface">
            {formatCount(channel.recentViews)}
          </span>
        </div>
      </div>

      {channel.outsideReason && (
        <p className="mt-space-sm rounded bg-space-deep p-2.5 text-body-sm text-on-surface-variant">
          <span className="text-outline">Not counted as like yours: </span>
          {OUTSIDE_LABEL[channel.outsideReason]}
        </p>
      )}

      {channel.breakout && (
        <p className="mt-space-sm text-body-sm text-on-surface-variant">
          <span className="text-outline">Top recent video: </span>
          {breakoutLink ? (
            <a
              href={breakoutLink}
              target="_blank"
              rel="noopener noreferrer"
              className="text-on-surface underline decoration-border-highlight underline-offset-2 hover:text-primary"
            >
              {channel.breakout.title}
            </a>
          ) : (
            channel.breakout.title
          )}
        </p>
      )}

      {link && (
        <a
          href={link}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-space-md flex items-center justify-center gap-2 rounded-full bg-primary-container py-2.5 text-body-sm font-semibold text-on-primary shadow-[0_0_12px_rgba(0,210,255,0.4)] transition-opacity hover:opacity-90"
        >
          Open channel on YouTube
          <ExternalLink aria-hidden="true" className="h-4 w-4" />
        </a>
      )}
      <button
        type="button"
        onClick={() => onSetRemoved(!channel.removed)}
        className="mt-2 w-full rounded-full bg-surface-container-high py-2.5 text-body-sm font-semibold text-on-surface transition-colors hover:bg-surface-variant"
      >
        {channel.removed ? 'Restore to my competitors' : 'Not a competitor: remove'}
      </button>
    </aside>
  );
}
