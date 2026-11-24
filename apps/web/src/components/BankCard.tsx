import type { BankCollection, BankVideo } from '@jgtube/core';
import { Check, Plus, ScanSearch, TrendingUp } from 'lucide-react';
import { closenessText, videoMeta } from '../lib/bank';
import { formatCount, formatScore, thumbnailUrl } from '../lib/format';
import { channelHref, videoHref } from '../lib/routes';
import { AddToFormat } from './AddToFormat';
import { BankSave } from './BankSave';
import { ChannelLogo } from './ChannelLogo';
import { MoneyBadge } from './MoneyBadge';
import { CAUTION_LABEL } from './tiers';

/** Above this multiple the usual views are shown beside it: a tiny usual makes a huge multiple. */
const HUGE_SCORE = 500;
const QUIET =
  'flex min-h-10 items-center gap-1.5 rounded-full px-3 text-body-sm font-semibold text-on-surface-variant transition-colors hover:bg-surface-card hover:text-on-surface';

/** What the score rests on: the usual it divides by and how many videos that came from. */
function scoreTip(video: BankVideo): string {
  if (video.score === null || video.baseline === null) {
    return 'Not scored: the channel has too few stored videos to compare against.';
  }
  const caution = video.caution ? ` ${CAUTION_LABEL[video.caution].detail}` : '';
  return `${formatScore(video.score)} its channel’s usual ${formatCount(Math.round(video.baseline))} views at this age, from ${video.sampleSize ?? 0} other videos.${caution}`;
}

function Picture({ video }: { readonly video: BankVideo }) {
  const thumbnail = thumbnailUrl(video.videoId);
  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-surface-container-high">
      {thumbnail && (
        <img
          src={thumbnail}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
        />
      )}
      <span
        title={scoreTip(video)}
        className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-space-deep/90 px-2 py-0.5 text-metric-badge text-metric-amber"
      >
        <TrendingUp aria-hidden="true" className="h-3.5 w-3.5" />
        {video.score === null ? 'Not scored' : formatScore(video.score)}
        {video.caution ? '*' : ''}
      </span>
    </div>
  );
}

function ChannelLine({ video }: { readonly video: BankVideo }) {
  const { channel } = video;
  const close = closenessText(channel.closeness);
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="flex h-7 w-7 flex-none items-center justify-center overflow-hidden rounded-full bg-surface-container-high text-label text-on-surface-variant">
        <ChannelLogo title={channel.title} logoUrl={channel.logoUrl} letters={1} />
      </span>
      <p className="min-w-0 truncate text-body-sm text-on-surface-variant">
        <a
          href={channelHref(channel.id)}
          className="font-semibold text-on-surface hover:text-primary hover:underline"
        >
          {channel.title}
        </a>
        {channel.subscribers !== null && ` · ${formatCount(channel.subscribers)} subs`}
        {close && ` · ${close}`}
      </p>
    </div>
  );
}

interface Props {
  readonly video: BankVideo;
  readonly picked: boolean;
  readonly onPick: () => void;
  readonly collections: readonly BankCollection[];
  readonly inCollections: readonly number[];
  readonly onSaved: (
    collections: readonly BankCollection[],
    inCollections: readonly number[],
  ) => void;
}

/** One outlier from the bank: picture with its multiple, title, channel, meta, tags and the four presses. */
export function BankCard({ video, picked, onPick, collections, inCollections, onSaved }: Props) {
  const href = videoHref(video.videoId);
  return (
    <article className="group flex min-w-0 flex-col gap-2">
      <Picture video={video} />
      <h3 className="line-clamp-2 break-words text-body-md font-semibold text-on-surface">
        {href ? (
          <a href={href} className="hover:text-primary">
            {video.title}
          </a>
        ) : (
          video.title
        )}
      </h3>
      <ChannelLine video={video} />
      <p className="text-body-sm text-outline">
        {videoMeta(video)}
        {video.score !== null && video.score > HUGE_SCORE && video.baseline !== null
          ? ` · usual ${formatCount(Math.round(video.baseline))}`
          : ''}
      </p>
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <span
          title={`Topic from ${video.channel.topic.source === 'keywords' ? 'the channel’s own keywords' : video.channel.topic.source === 'titles' ? 'its titles' : 'nothing clear'}`}
          className="rounded-full bg-surface-container px-2 py-0.5 text-label text-on-surface-variant"
        >
          {video.channel.topic.label}
        </span>
        <MoneyBadge channelId={video.channel.id} hideUnchecked />
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-1">
        <button
          type="button"
          aria-pressed={picked}
          onClick={onPick}
          className={`${QUIET} ${picked ? 'text-primary' : ''}`}
        >
          {picked ? (
            <Check aria-hidden="true" className="h-4 w-4" />
          ) : (
            <Plus aria-hidden="true" className="h-4 w-4" />
          )}
          {picked ? 'In ideas' : 'Add to ideas'}
        </button>
        <AddToFormat
          source={{ kind: 'video', use: 'video', videoId: video.videoId, center: null }}
          iconOnly
        />
        <a href={videoHref(video.videoId, 'teardown')} className={QUIET}>
          <ScanSearch aria-hidden="true" className="h-4 w-4" />
          Break down
        </a>
        <BankSave
          videoId={video.videoId}
          collections={collections}
          inCollections={inCollections}
          onChanged={onSaved}
        />
      </div>
    </article>
  );
}
