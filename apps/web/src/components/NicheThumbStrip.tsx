import { videoHref } from '../lib/routes';
import type { BoardVideo } from '@jgtube/core';
import { formatCount, formatScore, thumbnailUrl } from '../lib/format';

/** Three places, so every card's strip is the same height whatever it holds. */
const SLOTS = 3;

/** One small thumbnail with its multiple on it, linking to the video. */
function SmallThumb({ video }: { readonly video: BoardVideo }) {
  const href = videoHref(video.videoId);
  const src = thumbnailUrl(video.videoId);
  const score = video.score === null ? null : formatScore(video.score);
  const label = `${video.title}: ${formatCount(video.views)} views${score ? `, ${score} its usual views` : ''}`;
  const body = (
    <span className="relative block aspect-video w-full overflow-hidden rounded bg-surface-container-high">
      {src && (
        <img
          src={src}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          className="h-full w-full object-cover"
        />
      )}
      {score && (
        <span className="absolute left-1 top-1 rounded-full bg-[#2a1f08] px-1.5 text-metric-badge text-metric-amber">
          {score}
        </span>
      )}
    </span>
  );
  return href ? (
    <a href={href} title={label} aria-label={label}>
      {body}
    </a>
  ) : (
    <span title={label}>{body}</span>
  );
}

/** The videos that took off, as a strip of three small thumbnails. */
export function NicheThumbStrip({ videos }: { readonly videos: readonly BoardVideo[] }) {
  const shown = videos.slice(0, SLOTS);
  const empty = Array.from({ length: SLOTS - shown.length }, (_, index) => index);
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="flex items-center gap-1.5 text-label text-outline">
        <span aria-hidden="true" className="h-2 w-2 rounded-full bg-metric-amber" />
        {shown.length > 0 ? 'Took off' : 'No video taking off now'}
      </span>
      <div className="grid grid-cols-3 gap-1.5">
        {shown.map((video) => (
          <SmallThumb key={video.videoId} video={video} />
        ))}
        {empty.map((index) => (
          <span
            key={index}
            aria-hidden="true"
            className="block aspect-video rounded border border-dashed border-border-subtle"
          />
        ))}
      </div>
    </div>
  );
}
