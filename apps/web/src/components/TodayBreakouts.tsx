import type { BreakoutVideo } from '@jgtube/core';
import { ArrowRight } from 'lucide-react';
import { formatCount, formatScore, thumbnailUrl } from '../lib/format';
import { videoHref, viewHref } from '../lib/routes';
import { Card } from './layout/Card';

/** How many of today's breakouts Home shows. */
const SHOWN = 3;

/**
 * What is breaking out now on the open map, in brief: the three strongest
 * videos, each with its multiple and views, and the way to the full list.
 */
export function TodayBreakouts({ breakouts }: { readonly breakouts: readonly BreakoutVideo[] }) {
  const top = [...breakouts].sort((a, b) => b.score - a.score).slice(0, SHOWN);
  return (
    <Card label="Breaking out now">
      <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-headline-md font-bold text-on-surface">Breaking out now</h3>
        <a
          href={viewHref('breakouts')}
          className="flex items-center gap-1 text-body-sm font-semibold text-primary hover:underline"
        >
          See all {breakouts.length}
          <ArrowRight aria-hidden="true" className="h-4 w-4" />
        </a>
      </div>
      <ol className="flex min-w-0 flex-col divide-y divide-border-subtle">
        {top.map((video) => {
          const picture = thumbnailUrl(video.videoId);
          return (
            <li key={video.videoId} className="min-w-0">
              <a
                href={videoHref(video.videoId)}
                className="group flex min-w-0 items-center gap-space-md rounded py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
              >
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
                  <span className="line-clamp-2 text-body-md text-on-surface group-hover:text-link">
                    {video.title}
                  </span>
                  <span className="text-body-sm text-on-surface-variant">
                    <span className="font-semibold text-metric-amber">
                      {formatScore(video.score)}
                    </span>{' '}
                    · {video.channelTitle} · {formatCount(video.views)} views
                  </span>
                </span>
              </a>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
