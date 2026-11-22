import type { SameTopicChannel } from '@jgtube/core';
import { Plus } from 'lucide-react';
import { channelUrl, formatCount, formatScore, initials, percent, watchUrl } from '../lib/format';
import { Card, Label } from './layout/Card';
import { Outbound, Stat } from './NicheCard';
import { MoneyBadge } from './MoneyBadge';

interface Props {
  /** Its place in the list, closest wording first. */
  readonly number: number;
  readonly channel: SameTopicChannel;
  /** True while a choice about any channel is being saved. */
  readonly busy: boolean;
  readonly onKeep: () => void;
}

function Numbers({ channel }: { readonly channel: SameTopicChannel }) {
  return (
    <dl className="grid grid-cols-2 gap-3 rounded-lg bg-space-deep p-space-sm sm:grid-cols-4">
      <Stat label="Subscribers">{formatCount(channel.subscribers)}</Stat>
      <Stat label="Same title words">
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

/** What the channel has been publishing, one title a row, with its views. */
function RecentTitles({ channel }: { readonly channel: SameTopicChannel }) {
  if (channel.recentTitles.length === 0) return null;
  return (
    <div className="flex flex-col gap-space-sm">
      <Label>Recent titles</Label>
      <ul className="flex flex-col divide-y divide-border-subtle rounded-lg border border-border-subtle">
        {channel.recentTitles.map((video) => (
          <li key={video.videoId} className="flex items-baseline justify-between gap-3 px-3 py-2">
            <span className="line-clamp-2 min-w-0 text-body-md text-on-surface">
              <Outbound href={watchUrl(video.videoId)}>{video.title}</Outbound>
            </span>
            <span className="flex-none text-body-sm text-outline">
              {formatCount(video.views)} views
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** One channel the filter left out for its wording: its numbers and what it has been publishing. */
export function SameTopicCard({ number, channel, busy, onKeep }: Props) {
  return (
    <Card as="article">
      <div className="flex min-w-0 flex-wrap items-center gap-space-sm">
        <span className="flex-none text-body-sm text-outline">#{number}</span>
        <span className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-surface-container-high text-body-sm font-bold text-secondary ring-2 ring-border-subtle">
          {initials(channel.title).charAt(0)}
        </span>
        <div className="flex min-w-0 flex-1 basis-40 flex-col">
          <h3 className="truncate text-title-md text-on-surface">
            <Outbound href={channelUrl(channel.id)}>{channel.title}</Outbound>
          </h3>
          <span className="flex min-w-0 flex-wrap items-center gap-x-2">
            {channel.handle && (
              <span className="truncate text-body-sm text-outline">@{channel.handle}</span>
            )}
            <MoneyBadge channelId={channel.id} />
          </span>
        </div>
        <button
          title="Adds it to the look-alikes on your map, so its videos count in your research"
          type="button"
          disabled={busy}
          aria-label={`Keep ${channel.title} as a competitor`}
          onClick={onKeep}
          className="flex min-h-10 w-full flex-none items-center justify-center gap-1.5 rounded-full bg-surface-container-high px-4 text-body-sm font-semibold text-primary transition-colors hover:bg-surface-container-highest disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
        >
          <Plus aria-hidden="true" className="h-4 w-4" />
          Add to my competitors
        </button>
      </div>
      <Numbers channel={channel} />
      <RecentTitles channel={channel} />
    </Card>
  );
}
