import { Link2 } from 'lucide-react';
import { formatCount, thumbnailUrl } from '../lib/format';
import { Card } from './layout/Card';
import { Notice } from './layout/Notice';
import { useChannelProfile } from './useChannelProfile';

interface Props {
  readonly channelId: string;
  readonly reloadKey: string;
  /** Whether a kept idea is waiting to be linked; without one there is nothing to link to. */
  readonly canLink: boolean;
  /** Puts this video in the Link a video form. */
  readonly onLink: (videoId: string) => void;
}

const LINK_BUTTON =
  'flex min-h-11 flex-none items-center gap-1.5 rounded-full px-3 text-body-sm font-semibold text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface';

/**
 * Your own newest uploads, before any is linked: each with the way to link
 * it to the kept idea it came from, so the plan starts from what is there.
 */
export function OwnUploads({ channelId, reloadKey, canLink, onLink }: Props) {
  const state = useChannelProfile(channelId, reloadKey);
  if (state.status === 'loading') return <Notice tone="working">Reading your uploads.</Notice>;
  if (state.status !== 'ready' || state.profile.recent.length === 0) return null;
  return (
    <Card label="Your uploads">
      <div className="flex flex-col gap-1">
        <h3 className="text-headline-md font-bold text-on-surface">Your uploads</h3>
        <p className="text-body-sm text-on-surface-variant">
          {canLink
            ? 'Link one to the saved idea it came from to see how it did.'
            : 'Save an idea in Ideas, then link the video it became.'}
        </p>
      </div>
      <ul className="flex flex-col divide-y divide-border-subtle">
        {state.profile.recent.map((video) => {
          const picture = thumbnailUrl(video.videoId);
          return (
            <li key={video.videoId} className="flex min-w-0 items-center gap-space-md py-2">
              <span className="aspect-video w-24 flex-none overflow-hidden rounded bg-surface-container-high">
                {picture && (
                  <img
                    src={picture}
                    alt=""
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    className="h-full w-full object-cover"
                  />
                )}
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="line-clamp-2 text-body-md text-on-surface">{video.title}</span>
                <span className="text-body-sm text-outline">
                  {formatCount(video.views)} views · {video.publishedRaw}
                </span>
              </span>
              {canLink && (
                <button type="button" onClick={() => onLink(video.videoId)} className={LINK_BUTTON}>
                  <Link2 aria-hidden="true" className="h-4 w-4" />
                  Link
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
