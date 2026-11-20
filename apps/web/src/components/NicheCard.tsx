import type { NicheChannel, NicheReason } from '@jgtube/core';
import { Bookmark, BookmarkCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import { scoreTone } from '../lib/board';
import { channelUrl, formatCount, initials, watchUrl } from '../lib/format';
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
import { ThumbnailTile } from './ThumbnailTile';

/** The multiple from which a score is drawn in amber, as on the thumbnail board. */
const AMBER = { winnerMinScore: 2 };
const PILL = 'rounded-full bg-surface-container-high px-2 py-0.5 text-label-caps';

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
      <dt className="truncate text-label-caps text-outline">{label}</dt>
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
}

function WatchToggle({ channel, onSetWatched }: Props) {
  const Icon = channel.watched ? BookmarkCheck : Bookmark;
  return (
    <button
      type="button"
      aria-pressed={channel.watched}
      aria-label={channel.watched ? `Stop watching ${channel.title}` : `Watch ${channel.title}`}
      onClick={() => onSetWatched(!channel.watched)}
      className={`ml-auto flex flex-none items-center gap-1.5 rounded-full px-3 py-2 text-label-caps transition-colors ${
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
        <span className="text-label-caps text-outline">{describeHits(channel)}</span>
      </div>
      {origin && (
        <p
          className="text-label-caps text-outline"
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
    <dl className="grid grid-cols-2 gap-2 rounded bg-space-deep p-2.5 sm:grid-flow-col sm:grid-cols-3 sm:grid-rows-2">
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
    <div
      className="flex flex-col gap-0.5 text-label-caps text-outline"
      title="A rough range from typical ad rates for the views on this channel's uploads. Jgtube cannot see whether the channel is monetised or where its viewers live; the rate is scaled by a rough tier for the channel's own country when YouTube's records give one."
    >
      <p>{describeEarnings(channel.ninetyDayEarnings, 90)} · estimate</p>
      <p>{describeEarnings(channel.earnings)} · estimate</p>
      <p>{describeRateTier(channel.earnings.rateTier)}</p>
    </div>
  );
}

/** The videos that took off, as thumbnails, then the other titles it has been publishing. */
function Videos({ channel }: { readonly channel: NicheChannel }) {
  const others = otherTitles(channel);
  return (
    <>
      {channel.outperformers.length > 0 && (
        <div className="flex min-w-0 flex-col gap-space-sm">
          <div className="flex flex-wrap items-center gap-1.5 text-label-caps text-outline">
            <span aria-hidden="true" className="h-2 w-2 rounded-full bg-metric-amber" />
            <span className="uppercase text-on-surface-variant">Took off</span>
            <span>far above its size or its usual views</span>
          </div>
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
        <div className="flex flex-col gap-space-sm">
          <span className="text-label-caps uppercase text-outline">Also publishing</span>
          <ul className="flex flex-col gap-space-sm">
            {others.map((sample) => (
              <li key={sample.videoId} className="flex items-baseline justify-between gap-3">
                <span className="line-clamp-2 min-w-0 text-body-sm text-on-surface">
                  <Outbound href={watchUrl(sample.videoId)}>{sample.title}</Outbound>
                </span>
                <span className="flex-none text-label-caps text-outline">
                  {formatCount(sample.views)} views
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

/** One channel worth a look: why it is here, its numbers, and the videos that took off. */
export function NicheCard({ channel, onSetWatched }: Props) {
  return (
    <article
      className={`flex min-w-0 flex-col gap-space-md rounded bg-surface-card p-space-md shadow-md ${
        channel.watched ? 'ring-1 ring-border-highlight' : ''
      }`}
    >
      <div className="flex min-w-0 items-center gap-space-sm">
        <div className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-space-deep text-xs font-bold text-secondary">
          {initials(channel.title).charAt(0)}
        </div>
        <div className="flex min-w-0 flex-col">
          <h3 className="truncate text-title-md text-on-surface">
            <Outbound href={channelUrl(channel.id)}>{channel.title}</Outbound>
          </h3>
          {channel.handle && (
            <span className="truncate text-label-caps text-outline">@{channel.handle}</span>
          )}
        </div>
        <WatchToggle channel={channel} onSetWatched={onSetWatched} />
      </div>
      <Evidence channel={channel} />
      <Numbers channel={channel} />
      <Earnings channel={channel} />
      {channel.growth && (
        <p
          className="text-label-caps text-outline"
          title="Counted from the view numbers Jgtube stored each time it read this channel: the first reading of the last 30 days against the latest."
        >
          <span className="text-primary-fixed-dim">{describeGrowth(channel.growth)}</span> ·
          measured
        </p>
      )}
      <Videos channel={channel} />
    </article>
  );
}
