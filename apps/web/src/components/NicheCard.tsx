import type { NicheChannel, NicheReason } from '@jgtube/core';
import { Bookmark, BookmarkCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import { scoreTone } from '../lib/board';
import { channelUrl, formatCount, watchUrl } from '../lib/format';
import { ChannelLogo } from './ChannelLogo';
import {
  describeEarnings,
  describeGrowth,
  describeHits,
  describeLanguage,
  describeOrigin,
  describeRateTier,
  formatPerSubscriber,
  otherTitles,
} from '../lib/niches';
import { Card, Label } from './layout/Card';
import { Details } from './layout/Details';
import { ThumbnailTile } from './ThumbnailTile';

/** The multiple from which a score is drawn in amber, as on the thumbnail board. */
const AMBER = { winnerMinScore: 2 };
const PILL = 'rounded-full bg-surface-container-high px-2 py-0.5 text-label';

const REASON_LABEL: Readonly<Record<NicheReason, string>> = {
  new: 'New channel',
  small: 'Small channel',
};

export function Stat({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col">
      <dt className="truncate text-label text-outline">{label}</dt>
      <dd className="text-title-md text-on-surface">{children}</dd>
    </div>
  );
}

/** A link to YouTube when the id is well formed, plain text otherwise. */
export function Outbound({
  href,
  children,
}: {
  readonly href: string | null;
  readonly children: ReactNode;
}) {
  return href ? (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="transition-colors hover:text-primary"
    >
      {children}
    </a>
  ) : (
    <>{children}</>
  );
}

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
      className={`ml-auto flex flex-none items-center gap-1.5 rounded-full px-3 py-2 text-label transition-colors ${
        channel.watched
          ? 'bg-primary-container font-semibold text-on-primary'
          : 'bg-surface-container-high text-on-surface hover:bg-surface-variant'
      }`}
    >
      <Icon aria-hidden="true" className="h-4 w-4" />
      {channel.watched ? 'Watching' : 'Watch'}
    </button>
  );
}

/** Why the channel is listed, how often its videos take off, and when and where it started. */
function Evidence({ channel }: { readonly channel: NicheChannel }) {
  const origin = describeOrigin(channel);
  return (
    <div className="flex flex-col gap-space-sm">
      <div className="flex flex-wrap items-center gap-2">
        {channel.reasons.map((reason) => (
          <span key={reason} className={`${PILL} text-primary-fixed-dim`}>
            {REASON_LABEL[reason]}
          </span>
        ))}
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
        <span className="text-label text-outline">{describeHits(channel)}</span>
      </div>
      {origin && (
        <p
          className="text-label text-outline"
          title="The first upload is the oldest video Jgtube has read. The account's year and the country come from YouTube's official records, once a refresh or a search has asked for them."
        >
          {origin}
        </p>
      )}
    </div>
  );
}

/**
 * Size, then the two windows. On a wide card the pairs stand as three columns;
 * on a phone as three rows, so each window's views and uploads stay together.
 */
function Numbers({ channel }: { readonly channel: NicheChannel }) {
  return (
    <dl className="grid grid-cols-2 gap-3 rounded-lg bg-space-deep p-space-sm sm:grid-flow-col sm:grid-cols-3 sm:grid-rows-2">
      <Stat label="Subscribers">{formatCount(channel.subscribers)}</Stat>
      <Stat label="Per subscriber">
        <span className="text-secondary">{formatPerSubscriber(channel.viewsPerSubscriber)}</span>
      </Stat>
      <Stat label="90-day views">
        <span className="text-primary">{formatCount(channel.ninetyDayViews)}</span>
      </Stat>
      <Stat label="90-day uploads">{channel.ninetyDayUploads}</Stat>
      <Stat label="30-day views">
        <span className="text-primary">{formatCount(channel.recentViews)}</span>
      </Stat>
      <Stat label="30-day uploads">{channel.recentUploads}</Stat>
    </dl>
  );
}

/** What the views are worth over both windows, and which ad rate that was worked out at. */
function Earnings({ channel }: { readonly channel: NicheChannel }) {
  return (
    <Details summary="What the views may be worth (estimate)">
      <div className="flex flex-col gap-1 text-body-sm text-on-surface-variant">
        <p>{describeEarnings(channel.ninetyDayEarnings, 90)} · estimate</p>
        <p>{describeEarnings(channel.earnings)} · estimate</p>
        <p className="text-outline">{describeRateTier(channel.earnings.rateTier)}</p>
        <p className="text-outline">
          A rough range from typical ad rates for the views on this channel&rsquo;s uploads. Jgtube
          cannot see whether the channel is monetised or where its viewers live.
        </p>
      </div>
    </Details>
  );
}

/** The videos that took off, as thumbnails, then the other titles it has been publishing. */
function Videos({ channel }: { readonly channel: NicheChannel }) {
  const others = otherTitles(channel);
  return (
    <>
      {channel.outperformers.length > 0 && (
        <div className="flex min-w-0 flex-col gap-space-sm">
          <Label>
            <span className="flex items-center gap-1.5">
              <span aria-hidden="true" className="h-2 w-2 rounded-full bg-metric-amber" />
              Took off: far above its size or its usual views
            </span>
          </Label>
          <div className="grid grid-cols-2 gap-x-3 gap-y-space-md sm:grid-cols-3">
            {channel.outperformers.map((video) => (
              <ThumbnailTile
                key={video.videoId}
                video={video}
                tone={scoreTone(video.score, AMBER)}
              />
            ))}
          </div>
        </div>
      )}
      {others.length > 0 && (
        <Details summary={`Also publishing (${others.length})`}>
          <ul className="flex flex-col gap-space-sm">
            {others.map((sample) => (
              <li key={sample.videoId} className="flex items-baseline justify-between gap-3">
                <span className="line-clamp-2 min-w-0 text-body-sm text-on-surface">
                  <Outbound href={watchUrl(sample.videoId)}>{sample.title}</Outbound>
                </span>
                <span className="flex-none text-label text-outline">
                  {formatCount(sample.views)} views
                </span>
              </li>
            ))}
          </ul>
        </Details>
      )}
    </>
  );
}

/** The channel's own logo once it has been read, and its initial until then. */
function Logo({ channel }: { readonly channel: NicheChannel }) {
  return (
    <div className="flex h-10 w-10 flex-none items-center justify-center overflow-hidden rounded-full bg-surface-container-high text-body-sm font-bold text-secondary ring-2 ring-border-subtle">
      <ChannelLogo title={channel.title} logoUrl={channel.logoUrl} letters={1} />
    </div>
  );
}

/** One channel worth a look: why it is here, its numbers, and the videos that took off. */
export function NicheCard({ channel, onSetWatched, onBreakDown }: Props) {
  return (
    <Card as="article" highlighted={channel.watched}>
      <div className="flex min-w-0 items-center gap-space-sm">
        <Logo channel={channel} />
        <div className="flex min-w-0 flex-col">
          <h3 className="truncate text-title-md text-on-surface">
            <Outbound href={channelUrl(channel.id)}>{channel.title}</Outbound>
          </h3>
          {channel.handle && (
            <span className="truncate text-body-sm text-outline">@{channel.handle}</span>
          )}
        </div>
        <WatchToggle channel={channel} onSetWatched={onSetWatched} />
      </div>
      <Evidence channel={channel} />
      <Numbers channel={channel} />
      <Earnings channel={channel} />
      {channel.growth && (
        <p
          className="text-label text-outline"
          title="Counted from the view numbers Jgtube stored each time it read this channel: the first reading of the last 30 days against the latest."
        >
          <span className="text-primary-fixed-dim">{describeGrowth(channel.growth)}</span> ·
          measured
        </p>
      )}
      <Videos channel={channel} />
      {onBreakDown && (
        <button
          type="button"
          onClick={onBreakDown}
          className="self-start rounded-full bg-surface-container-high px-4 py-2 text-body-sm font-semibold text-primary ring-1 ring-primary-container transition-colors hover:bg-primary-container hover:text-on-primary"
        >
          Break down this channel
        </button>
      )}
    </Card>
  );
}
