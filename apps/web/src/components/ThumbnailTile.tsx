import { videoHref } from '../lib/routes';
import { AddToFormat } from './AddToFormat';
import type { BoardVideo } from '@jgtube/core';
import type { ScoreTone } from '../lib/board';
import { formatCount, formatDuration, formatScore, thumbnailUrl } from '../lib/format';

const BADGE: Readonly<Record<Exclude<ScoreTone, 'none'>, string>> = {
  winner: 'bg-[#2a1f08] text-metric-amber shadow-[0_0_8px_rgba(251,191,36,0.3)]',
  plain: 'bg-space-deep/90 text-on-surface-variant',
};

interface Props {
  readonly video: BoardVideo;
  readonly tone: ScoreTone;
  /** Offers to put its layout on the format builder's shelf. */
  readonly addable?: boolean;
}

/** One 16:9 thumbnail with its score on it, linking to the video. */
export function ThumbnailTile({ video, tone, addable }: Props) {
  const href = videoHref(video.videoId);
  const thumbnail = thumbnailUrl(video.videoId);
  const duration = formatDuration(video.durationSeconds);
  const body = (
    <>
      <div className="relative aspect-video w-full overflow-hidden rounded bg-surface-container-high">
        {thumbnail && (
          <img
            src={thumbnail}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        )}
        {tone !== 'none' && video.score !== null && (
          <span
            className={`absolute left-2 top-2 rounded-full px-1.5 py-0.5 text-metric-badge ${BADGE[tone]}`}
          >
            {formatScore(video.score)}
          </span>
        )}
        {duration && (
          <span className="absolute bottom-2 right-2 rounded bg-space-deep/90 px-1.5 py-0.5 text-label font-semibold text-on-surface">
            {duration}
          </span>
        )}
      </div>
      <span className="line-clamp-2 text-body-sm text-on-surface transition-colors group-hover:text-primary">
        {video.title}
      </span>
      <span className="text-label text-outline">
        {formatCount(video.views)} views · {video.publishedRaw}
      </span>
    </>
  );
  const className = 'group flex min-w-0 flex-col gap-1.5';
  const tile = href ? (
    <a href={href} className={className}>
      {body}
    </a>
  ) : (
    <div className={className}>{body}</div>
  );
  if (!addable) return tile;
  return (
    <div className="flex min-w-0 flex-col items-start gap-1">
      {tile}
      <AddToFormat
        source={{ kind: 'video', use: 'thumbnail', videoId: video.videoId, center: null }}
        label="Add layout"
      />
    </div>
  );
}
