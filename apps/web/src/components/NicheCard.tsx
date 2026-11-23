import type { NicheChannel } from '@jgtube/core';
import { Bookmark, BookmarkCheck } from 'lucide-react';
import { channelUrl, formatAge, formatCount, formatScore } from '../lib/format';
import { bestScore, describeTopicSource } from '../lib/nicheBuckets';
import { describeLanguage, isRestarted } from '../lib/niches';
import { channelHref } from '../lib/routes';
import { ChannelLogo } from './ChannelLogo';
import { Card } from './layout/Card';
import { Details } from './layout/Details';
import { MoneyBadge } from './MoneyBadge';
import { NicheCardDetails } from './NicheCardDetails';
import { Outbound } from './NicheParts';
import { NicheThumbStrip } from './NicheThumbStrip';

export { Outbound, Stat } from './NicheParts';

const PILL = 'whitespace-nowrap rounded-full bg-surface-container-high px-2 py-0.5 text-label';
const QUIET =
  'flex min-h-10 items-center rounded-full px-3 text-body-sm font-semibold text-primary transition-colors hover:bg-surface-container-high';

interface Props {
  readonly channel: NicheChannel;
  readonly onSetWatched: (watched: boolean) => void;
  /** Starts a channel breakdown of this channel; absent where none can be started. */
  readonly onBreakDown?: (() => void) | undefined;
}

function WatchToggle({ channel, onSetWatched }: Props) {
  const Icon = channel.watched ? BookmarkCheck : Bookmark;
  return (
    <button
      type="button"
      aria-pressed={channel.watched}
      aria-label={channel.watched ? `Stop watching ${channel.title}` : `Watch ${channel.title}`}
      onClick={() => onSetWatched(!channel.watched)}
      className={`ml-auto flex min-h-10 flex-none items-center gap-1 rounded-full px-3 text-label transition-colors ${
        channel.watched
          ? 'bg-primary-container font-semibold text-on-primary'
          : 'bg-surface-container-high text-on-surface hover:bg-surface-variant'
      }`}
    >
      <Icon aria-hidden="true" className="h-4 w-4" />
      {/* Two narrow cards to a row on a tablet: the icon alone, the name read from aria-label. */}
      <span className="sm:hidden lg:inline">{channel.watched ? 'Saved' : 'Save'}</span>
    </button>
  );
}

/** How old the channel is, in a few words; null when its first upload is not known. */
function ageTag(channel: NicheChannel, now: Date): string | null {
  if (channel.channelAgeDays === null) return null;
  const age = formatAge(channel.channelAgeDays);
  if (isRestarted(channel, now)) return `Restarted ${age} ago`;
  return channel.reasons.includes('new') ? `New channel · ${age}` : `${age} old`;
}

/** The short marks: money signs, niche, age, alphabet, and a watched channel that stopped outperforming. */
function Tags({ channel }: { readonly channel: NicheChannel }) {
  const age = ageTag(channel, new Date());
  return (
    <div className="flex min-h-6 min-w-0 flex-wrap items-center gap-1.5">
      <MoneyBadge channelId={channel.id} />
      {channel.topic.source !== 'none' && (
        <span
          className={`${PILL} text-on-surface`}
          title={describeTopicSource(channel.topic)}
          aria-label={`Niche: ${channel.topic.label}. ${describeTopicSource(channel.topic)}`}
        >
          {channel.topic.label}
        </span>
      )}
      {age && <span className={`${PILL} text-primary-fixed-dim`}>{age}</span>}
      {channel.otherLanguage && (
        <span
          className={`${PILL} text-secondary`}
          title="Most of its titles are in another alphabet. An idea that works there may not have been made in your language yet. Jgtube does not translate."
        >
          {describeLanguage(channel.otherLanguage)}
        </span>
      )}
      {!channel.qualifies && (
        <span className={`${PILL} text-on-surface-variant`}>No longer outperforming</span>
      )}
    </div>
  );
}

/** Subscribers, views on the last 30 days of uploads, and the best multiple, on one line. */
function KeyNumbers({ channel }: { readonly channel: NicheChannel }) {
  const best = bestScore(channel);
  return (
    <p className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-body-sm text-outline">
      <span>
        <span className="font-semibold text-on-surface">{formatCount(channel.subscribers)}</span>{' '}
        subs
      </span>
      ·
      <span>
        <span className="font-semibold text-primary">{formatCount(channel.recentViews)}</span>{' '}
        30-day views
      </span>
      {best !== null && (
        <>
          ·
          <span>
            <span className="font-semibold text-metric-amber">{formatScore(best)}</span> best
          </span>
        </>
      )}
    </p>
  );
}

/** The channel's logo, name and handle, with Save at the right. */
function Header({ channel, onSetWatched }: Props) {
  return (
    <div className="flex min-w-0 items-center gap-space-sm">
      <div className="flex h-10 w-10 flex-none items-center justify-center overflow-hidden rounded-full bg-surface-container-high text-body-sm font-bold text-secondary ring-2 ring-border-subtle">
        <ChannelLogo title={channel.title} logoUrl={channel.logoUrl} letters={1} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <h3 className="truncate text-body-md font-semibold text-on-surface">
          <Outbound href={channelUrl(channel.id)}>{channel.title}</Outbound>
        </h3>
        {channel.handle && (
          <span className="truncate text-body-sm text-outline">@{channel.handle}</span>
        )}
      </div>
      <WatchToggle channel={channel} onSetWatched={onSetWatched} />
    </div>
  );
}

/** One channel worth a look, small enough to stand three in a row; the rest behind Details. */
export function NicheCard({ channel, onSetWatched, onBreakDown }: Props) {
  return (
    <Card as="article" medium highlighted={channel.watched} className="h-full">
      <Header channel={channel} onSetWatched={onSetWatched} />
      <Tags channel={channel} />
      <KeyNumbers channel={channel} />
      <NicheThumbStrip videos={channel.outperformers} />
      <div className="mt-auto flex min-w-0 flex-col gap-space-sm pt-space-xs">
        <div className="flex min-w-0 flex-wrap items-center gap-1">
          <a href={channelHref(channel.id)} className={QUIET}>
            Open
          </a>
          {onBreakDown && (
            <button type="button" onClick={onBreakDown} className={QUIET}>
              Break down
            </button>
          )}
        </div>
        <Details summary="Details">
          <NicheCardDetails channel={channel} />
        </Details>
      </div>
    </Card>
  );
}
