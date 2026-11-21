import { useState } from 'react';
import { thumbnailUrl } from '../lib/format';
import { pickList, scoreText, type PickableVideos } from '../lib/thumbReview';
import { ShowMore } from './layout/Notice';

const SHOWN_AT_FIRST = 8;

interface Props {
  readonly videos: PickableVideos | null;
  readonly picked: string | null;
  readonly onPick: (videoId: string) => void;
}

/** The videos to review, yours first and newest first, each with its thumbnail and title. */
export function ThumbnailReviewPicker({ videos, picked, onPick }: Props) {
  const [shown, setShown] = useState(SHOWN_AT_FIRST);
  const all = pickList(videos);
  const own = new Set(videos?.own.map((video) => video.videoId) ?? []);
  if (all.length === 0) return null;
  return (
    <div className="flex min-w-0 flex-col gap-space-sm">
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {all.slice(0, shown).map((video) => {
          const src = thumbnailUrl(video.videoId);
          const chosen = video.videoId === picked;
          return (
            <li key={video.videoId} className="min-w-0">
              <button
                type="button"
                aria-pressed={chosen}
                onClick={() => onPick(video.videoId)}
                className={`flex w-full min-w-0 flex-col gap-1 rounded border p-1.5 text-left transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-primary-container ${
                  chosen
                    ? 'border-border-highlight bg-surface-container-high'
                    : 'border-border-subtle hover:border-border-highlight'
                }`}
              >
                <span className="block aspect-video w-full overflow-hidden rounded bg-surface-container-high">
                  {src && (
                    <img
                      src={src}
                      alt=""
                      loading="lazy"
                      referrerPolicy="no-referrer"
                      className="h-full w-full object-cover"
                    />
                  )}
                </span>
                <span className="line-clamp-2 text-body-sm text-on-surface">{video.title}</span>
                <span className="truncate text-label-caps normal-case text-outline">
                  {own.has(video.videoId) ? 'Yours' : video.channelTitle} · {scoreText(video.score)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {all.length > shown && (
        <ShowMore
          left={all.length - shown}
          noun="videos"
          onClick={() => setShown((count) => count + SHOWN_AT_FIRST)}
        />
      )}
    </div>
  );
}
