import { formatCount, thumbnailUrl, watchUrl } from '../lib/format';
import type { NamedVideo } from '../lib/videoRefs';

/** One named video as a small thumbnail that opens the video, its title beneath. */
function Chip({ video }: { readonly video: NamedVideo }) {
  const href = watchUrl(video.videoId);
  const src = thumbnailUrl(video.videoId);
  if (href === null || src === null) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={`${video.title} · ${video.channelTitle} · ${formatCount(video.views)} views`}
      className="group flex w-28 flex-none flex-col gap-1 rounded focus:outline-none focus-visible:ring-1 focus-visible:ring-primary-container sm:w-32"
    >
      <span className="block aspect-video w-full overflow-hidden rounded bg-surface-container-high">
        <img
          src={src}
          alt={`Thumbnail of “${video.title}”`}
          loading="lazy"
          referrerPolicy="no-referrer"
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
        />
      </span>
      <span className="line-clamp-2 text-label-caps normal-case text-on-surface-variant group-hover:text-primary">
        {video.title}
      </span>
      <span className="truncate text-label-caps normal-case text-outline">
        {video.channelTitle} · {formatCount(video.views)}
      </span>
    </a>
  );
}

/**
 * The real thumbnails of the videos a point of an AI's answer rests on, each
 * linking to its video. Nothing is shown for a point that names none.
 */
export function VideoChips({ videos }: { readonly videos: readonly NamedVideo[] }) {
  if (videos.length === 0) return null;
  return (
    <div className="flex min-w-0 flex-wrap gap-2 pt-1" aria-label="The videos this rests on">
      {videos.map((video) => (
        <Chip key={video.videoId} video={video} />
      ))}
    </div>
  );
}

/** One video on a line: its real thumbnail, its title linking to it, and its channel. */
export function VideoLine({
  video,
}: {
  readonly video: {
    readonly videoId: string;
    readonly title: string;
    readonly channelTitle: string;
  };
}) {
  const href = watchUrl(video.videoId);
  const src = thumbnailUrl(video.videoId);
  return (
    <span className="flex min-w-0 items-center gap-2">
      {src && (
        <img
          src={src}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          className="aspect-video w-16 flex-none rounded bg-surface-container-high object-cover"
        />
      )}
      <span className="min-w-0 truncate text-body-sm text-on-surface">
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-primary hover:underline focus:outline-none focus-visible:ring-1 focus-visible:ring-primary-container"
          >
            {video.title}
          </a>
        ) : (
          video.title
        )}
        <span className="text-outline"> · {video.channelTitle}</span>
      </span>
    </span>
  );
}
