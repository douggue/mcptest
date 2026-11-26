import { videoHref } from '../lib/routes';
import type { NicheChannel } from '@jgtube/core';
import { formatCount, formatScore } from '../lib/format';
import { describeRpm, rpmOf } from '../lib/nicheBuckets';
import {
  describeEarnings,
  describeGrowth,
  describeHits,
  describeOrigin,
  describeRateTier,
  formatPerSubscriber,
  otherTitles,
} from '../lib/niches';
import { Inside, Stat } from './NicheParts';

const NOTE = 'text-body-sm text-on-surface-variant';
const SUBHEAD = 'text-label text-outline';

/** Size, then the two windows, two to a row so each window's views and uploads stay together. */
function Numbers({ channel }: { readonly channel: NicheChannel }) {
  return (
    <dl className="grid grid-cols-2 gap-3 rounded-lg bg-space-deep p-space-sm">
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
    <div className="flex flex-col gap-1">
      <p className={SUBHEAD}>What the views may be worth (estimate)</p>
      <p className={NOTE}>{describeEarnings(channel.ninetyDayEarnings, 90)} · estimate</p>
      <p className={NOTE}>{describeEarnings(channel.earnings)} · estimate</p>
      <p className={NOTE}>{describeRpm(rpmOf(channel))} · estimate</p>
      <p className="text-body-sm text-outline">{describeRateTier(channel.earnings.rateTier)}</p>
      <p className="text-body-sm text-outline">
        A rough range from typical ad rates for the views on this channel&rsquo;s uploads. Jgtube
        cannot see whether the channel is monetised or where its viewers live.
      </p>
    </div>
  );
}

/** The videos that took off, by title, and the other titles it has been publishing. */
function Titles({ channel }: { readonly channel: NicheChannel }) {
  const rows = [
    ...channel.outperformers.map((video) => ({
      ...video,
      note: video.score === null ? '' : ` · ${formatScore(video.score)}`,
    })),
    ...otherTitles(channel).map((sample) => ({ ...sample, note: '' })),
  ];
  if (rows.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <p className={SUBHEAD}>Took off, then also publishing</p>
      <ul className="flex flex-col gap-space-sm">
        {rows.map((row) => (
          <li key={row.videoId} className="flex items-baseline justify-between gap-3">
            <span className="line-clamp-2 min-w-0 text-body-sm text-on-surface">
              <Inside href={videoHref(row.videoId)}>{row.title}</Inside>
            </span>
            <span className="flex-none text-label text-outline">
              {formatCount(row.views)} views{row.note}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Everything on a niche card that is needed only sometimes. */
export function NicheCardDetails({ channel }: { readonly channel: NicheChannel }) {
  const origin = describeOrigin(channel);
  return (
    <div className="flex min-w-0 flex-col gap-space-md">
      <p className={NOTE}>
        {describeHits(channel)}
        {origin ? ` · ${origin}` : ''}
      </p>
      <Numbers channel={channel} />
      <Earnings channel={channel} />
      {channel.growth && (
        <p
          className="text-body-sm text-outline"
          title="Counted from the view numbers Jgtube stored each time it read this channel: the first reading of the last 30 days against the latest."
        >
          <span className="text-primary-fixed-dim">{describeGrowth(channel.growth)}</span> ·
          measured
        </p>
      )}
      <Titles channel={channel} />
    </div>
  );
}
