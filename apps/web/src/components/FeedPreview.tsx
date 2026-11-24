import { videoHref } from '../lib/routes';
import type { BreakoutVideo } from '@jgtube/core';
import { formatCount, formatScore, thumbnailUrl } from '../lib/format';
import { previewNeighbours, titleCheck, type ConceptView } from '../lib/ideaLab';

/** The frame every card of the preview shares: a 16:9 picture, then two lines of title. */
const CARD = 'flex min-w-0 flex-col gap-2 rounded bg-space-deep p-space-sm';
const PICTURE = 'relative aspect-video w-full overflow-hidden rounded bg-surface-container-high';
const TITLE = 'line-clamp-2 text-body-md font-semibold text-on-surface';

interface DraftProps {
  readonly title: string;
  readonly overlay: string;
  readonly shorts: boolean;
}

/** The owner's draft as a plain card: the overlay text on an empty picture, the title, "Your channel". */
function Draft({ title, overlay, shorts }: DraftProps) {
  return (
    <div className={`${CARD} ring-1 ring-border-highlight`}>
      <div className={`${PICTURE} flex items-center justify-center p-space-sm`}>
        <span className="break-words text-center text-body-lg font-bold uppercase tracking-tight text-on-surface sm:text-headline-md">
          {overlay}
        </span>
      </div>
      <p className={TITLE}>{title}</p>
      <p className="text-body-sm text-on-surface-variant">Your draft{shorts ? ' · Short' : ''}</p>
    </div>
  );
}

/** A real video from this map, as a feed would show it. */
function Real({ video }: { readonly video: BreakoutVideo }) {
  const picture = thumbnailUrl(video.videoId);
  const href = videoHref(video.videoId);
  return (
    <div className={CARD}>
      <div className={PICTURE}>
        {picture && (
          <img
            src={picture}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            className="h-full w-full object-cover"
          />
        )}
      </div>
      <p className={TITLE}>
        {href ? (
          <a href={href} className="hover:text-primary">
            {video.title}
          </a>
        ) : (
          video.title
        )}
      </p>
      <p className="truncate text-body-sm text-on-surface-variant">
        {video.channelTitle} · {formatCount(video.views)} views ·{' '}
        <span className="text-metric-amber">{formatScore(video.score)}</span>
      </p>
    </div>
  );
}

interface Props {
  readonly concept: ConceptView;
  /** The title shown: the concept's own or one of its alternates. */
  readonly title: string;
  /** The breakouts of the map on screen. */
  readonly breakouts: readonly BreakoutVideo[];
}

/**
 * The draft beside two real videos that took off on this map, the way a feed
 * sets them side by side, with the title's length counted. A title is shown
 * on two lines here, as a feed shows it, so one that runs long is cut on
 * screen too.
 */
export function FeedPreview({ concept, title, breakouts }: Props) {
  const check = titleCheck(title, concept.length);
  const neighbours = previewNeighbours(
    breakouts,
    concept.restsOnVideos.map((video) => video.videoId),
  );
  return (
    <div className="flex flex-col gap-space-sm rounded bg-surface-container-low p-space-md">
      <span className="text-label text-outline">
        In a feed, beside videos that took off on this map
      </span>
      <div className="grid grid-cols-2 gap-space-sm sm:grid-cols-3">
        <Draft title={title} overlay={concept.overlay} shorts={concept.length === 'shorts'} />
        {neighbours.map((video, index) => (
          // On a phone, two side by side, as a phone's feed has room for.
          <div key={video.videoId} className={index > 0 ? 'hidden min-w-0 sm:block' : 'min-w-0'}>
            <Real video={video} />
          </div>
        ))}
      </div>
      {check.warning ? (
        <p role="note" className="text-body-sm text-metric-amber">
          {check.warning}
        </p>
      ) : (
        <p className="text-body-sm text-on-surface-variant">
          Title: {check.count} characters, inside the about {check.limit} a phone&rsquo;s feed
          shows.
        </p>
      )}
      {neighbours.length === 0 && (
        <p className="text-body-sm text-outline">
          This map has no breakout video to set beside it.
        </p>
      )}
    </div>
  );
}
