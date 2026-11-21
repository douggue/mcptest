import type { ProfileVideo } from '@jgtube/core';
import { formatCount, formatDuration, formatScore, thumbnailUrl, watchUrl } from '../lib/format';

/** One video: its thumbnail, title, views, date and outlier score, linked to YouTube. */
function VideoTile({ video }: { readonly video: ProfileVideo }) {
  const picture = thumbnailUrl(video.videoId);
  const link = watchUrl(video.videoId);
  const duration = formatDuration(video.durationSeconds);
  return (
    <li className="flex min-w-0 flex-col gap-1.5">
      <a
        href={link ?? undefined}
        target="_blank"
        rel="noopener noreferrer"
        className="relative block aspect-video overflow-hidden rounded bg-surface-card focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary-container"
      >
        {picture && (
          <img src={picture} alt="" loading="lazy" className="h-full w-full object-cover" />
        )}
        {video.score !== null && (
          <span className="absolute left-1.5 top-1.5 rounded-full bg-[#2a1f08] px-1.5 py-0.5 text-metric-badge text-metric-amber">
            {formatScore(video.score)}
          </span>
        )}
        {duration && (
          <span className="absolute bottom-1.5 right-1.5 rounded bg-space-deep/90 px-1 text-label text-on-surface">
            {duration}
          </span>
        )}
      </a>
      <span className="line-clamp-2 break-words text-body-sm font-semibold text-on-surface">
        {video.title}
      </span>
      <span className="text-label text-outline">
        {formatCount(video.views)} views · {video.publishedRaw}
      </span>
    </li>
  );
}

interface Props {
  readonly title: string;
  /** What the list is, in one line. */
  readonly lead: string;
  readonly videos: readonly ProfileVideo[];
  readonly empty: string;
}

/** A grid of some of a channel's stored videos. */
export function ChannelVideos({ title, lead, videos, empty }: Props) {
  return (
    <section className="flex min-w-0 flex-col gap-space-sm">
      <div>
        <h3 className="text-headline-md text-on-surface">{title}</h3>
        <p className="text-body-sm text-on-surface-variant">{lead}</p>
      </div>
      {videos.length === 0 ? (
        <p className="rounded bg-surface-card p-space-md text-body-sm text-on-surface-variant">
          {empty}
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-space-md min-[480px]:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {videos.map((video) => (
            <VideoTile key={video.videoId} video={video} />
          ))}
        </ul>
      )}
    </section>
  );
}
