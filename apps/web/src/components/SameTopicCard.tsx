import type { SameTopicChannel } from '@jgtube/core';
import { Plus } from 'lucide-react';
import { channelUrl, formatCount, formatScore, initials, percent, watchUrl } from '../lib/format';
import { Outbound, Stat } from './NicheCard';

interface Props {
  readonly channel: SameTopicChannel;
  /** True while a choice about any channel is being saved. */
  readonly busy: boolean;
  readonly onKeep: () => void;
}

function Numbers({ channel }: { readonly channel: SameTopicChannel }) {
  return (
    <dl className="grid grid-cols-2 gap-2 rounded bg-space-deep p-2.5 sm:grid-cols-4">
      <Stat label="Subscribers">{formatCount(channel.subscribers)}</Stat>
      <Stat label="Title match">
        <span className="text-secondary">{percent(channel.titleMatch)}</span>
      </Stat>
      <Stat label="30-day views">
        <span className="text-primary">{formatCount(channel.recentViews)}</span>
      </Stat>
      <Stat label="Best breakout">
        <span className="text-metric-amber">
          {channel.breakout ? formatScore(channel.breakout.score) : '—'}
        </span>
      </Stat>
    </dl>
  );
}

/** One channel the filter left out for its wording: its numbers and what it has been publishing. */
export function SameTopicCard({ channel, busy, onKeep }: Props) {
  return (
    <article className="flex min-w-0 flex-col gap-space-md rounded bg-surface-card p-space-md shadow-md">
      <div className="flex min-w-0 flex-wrap items-center gap-space-sm">
        <div className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-space-deep text-xs font-bold text-secondary">
          {initials(channel.title).charAt(0)}
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <h3 className="truncate text-title-md text-on-surface">
            <Outbound href={channelUrl(channel.id)}>{channel.title}</Outbound>
          </h3>
          {channel.handle && (
            <span className="truncate text-label-caps text-outline">@{channel.handle}</span>
          )}
        </div>
        <button
          type="button"
          disabled={busy}
          aria-label={`Keep ${channel.title} as a competitor`}
          onClick={onKeep}
          className="flex w-full flex-none items-center justify-center gap-1.5 rounded-full bg-surface-container-high px-3 py-2 text-label-caps text-on-surface transition-colors hover:bg-surface-variant disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
        >
          <Plus aria-hidden="true" className="h-4 w-4" />
          Keep as competitor
        </button>
      </div>
      <Numbers channel={channel} />
      {channel.recentTitles.length > 0 && (
        <div className="flex flex-col gap-space-sm">
          <span className="text-label-caps uppercase text-outline">Recent titles</span>
          <ul className="flex flex-col gap-space-sm">
            {channel.recentTitles.map((video) => (
              <li key={video.videoId} className="flex items-baseline justify-between gap-3">
                <span className="line-clamp-2 min-w-0 text-body-sm text-on-surface">
                  <Outbound href={watchUrl(video.videoId)}>{video.title}</Outbound>
                </span>
                <span className="flex-none text-label-caps text-outline">
                  {formatCount(video.views)} views
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </article>
  );
}
