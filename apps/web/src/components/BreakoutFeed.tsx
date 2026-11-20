import type { BreakoutVideo } from '@jgtube/core';
import { ArrowUpRight, Flame, TrendingUp } from 'lucide-react';
import { useState } from 'react';
import {
  BREAKOUT_FILTERS,
  describeEvidence,
  filterBreakouts,
  type BreakoutFilter,
} from '../lib/feed';
import {
  formatCount,
  formatDuration,
  formatScore,
  initials,
  thumbnailUrl,
  watchUrl,
} from '../lib/format';
import { CAUTION_LABEL } from './tiers';

const PAGE_SIZE = 8;

function Card({ item }: { readonly item: BreakoutVideo }) {
  const href = watchUrl(item.videoId);
  const thumbnail = thumbnailUrl(item.videoId);
  const duration = formatDuration(item.durationSeconds);
  return (
    <article className="group flex flex-col items-start gap-space-md rounded bg-surface-card p-space-md shadow-md transition-colors duration-300 hover:bg-surface-container-low sm:flex-row">
      <div className="relative aspect-video w-full flex-shrink-0 overflow-hidden rounded bg-surface-container-high sm:w-56">
        {thumbnail && (
          <img
            src={thumbnail}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        )}
        {duration && (
          <span className="absolute bottom-2 right-2 rounded bg-space-deep/90 px-1.5 py-0.5 text-label-caps font-semibold text-on-surface">
            {duration}
          </span>
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-between gap-space-sm py-0.5">
        <div>
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1 rounded-full bg-metric-amber-bg px-2 py-0.5 text-metric-badge text-metric-amber shadow-sm">
              <TrendingUp aria-hidden="true" className="h-3.5 w-3.5" />
              {formatScore(item.score)}
            </span>
            {item.caution && (
              <span
                title={CAUTION_LABEL[item.caution].detail}
                className="rounded-full bg-surface-container-high px-2 py-0.5 text-label-caps text-on-surface-variant"
              >
                {CAUTION_LABEL[item.caution].label}
              </span>
            )}
            <span className="text-label-caps text-outline">
              {formatCount(item.views)} views · {item.publishedRaw}
            </span>
          </div>
          <h3 className="line-clamp-2 text-title-md text-on-surface transition-colors group-hover:text-primary">
            {href ? (
              <a href={href} target="_blank" rel="noopener noreferrer">
                {item.title}
              </a>
            ) : (
              item.title
            )}
          </h3>
          <p className="mt-1 text-label-caps text-outline">{describeEvidence(item)}</p>
        </div>
        <div className="flex items-center justify-between text-body-sm text-on-surface-variant">
          <div className="flex min-w-0 items-center gap-2">
            <span className="flex h-5 w-5 flex-none items-center justify-center rounded-full bg-surface-container-high text-[10px] font-bold text-outline">
              {initials(item.channelTitle).charAt(0)}
            </span>
            <span className="truncate">{item.channelTitle}</span>
            <span className="flex-none text-outline">
              · {formatCount(item.channelSubscribers)} subscribers
            </span>
          </div>
          <ArrowUpRight
            aria-hidden="true"
            className="h-[18px] w-[18px] flex-none text-outline transition-colors group-hover:text-primary"
          />
        </div>
      </div>
    </article>
  );
}

interface Props {
  readonly items: readonly BreakoutVideo[];
  readonly centerTitle: string;
}

/** Recent videos across the map that are far above their channel's usual views. */
export function BreakoutFeed({ items, centerTitle }: Props) {
  const [filter, setFilter] = useState<BreakoutFilter>('all');
  const [shown, setShown] = useState(PAGE_SIZE);
  const matching = filterBreakouts(items, filter);
  const choose = (next: BreakoutFilter) => {
    setFilter(next);
    setShown(PAGE_SIZE);
  };

  return (
    <div className="flex flex-col gap-space-lg xl:col-span-8">
      <div className="flex flex-col justify-between gap-space-md pb-space-sm sm:flex-row sm:items-end">
        <div>
          <div className="flex items-center gap-2">
            <Flame aria-hidden="true" className="h-[22px] w-[22px] text-metric-amber" />
            <h2 className="text-headline-lg font-bold tracking-tight text-on-surface">
              Breaking out right now
            </h2>
          </div>
          <p className="mt-1 text-body-md text-on-surface-variant">
            Videos from the last 30 days far above their channel&rsquo;s usual views, on the
            channels around {centerTitle}.
          </p>
        </div>
        <div role="group" aria-label="Filter breakouts" className="flex items-center gap-1.5 pb-1">
          {BREAKOUT_FILTERS.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={filter === option.id}
              onClick={() => choose(option.id)}
              className={`whitespace-nowrap rounded-full px-3 py-1.5 text-label-caps transition-colors ${
                filter === option.id
                  ? 'bg-surface-card font-semibold text-primary shadow-sm'
                  : 'bg-surface-container text-on-surface-variant hover:bg-surface-card hover:text-on-surface'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {matching.length === 0 ? (
        <p className="rounded bg-surface-card p-space-lg text-body-md text-on-surface-variant">
          {items.length === 0
            ? 'No video on this map is far enough above its channel’s usual views yet.'
            : 'Nothing on this map matches that filter.'}
        </p>
      ) : (
        <div className="flex flex-col gap-space-md">
          {matching.slice(0, shown).map((item) => (
            <Card key={item.videoId} item={item} />
          ))}
          {matching.length > shown && (
            <button
              type="button"
              onClick={() => setShown((count) => count + PAGE_SIZE)}
              className="self-center rounded-full bg-surface-container px-5 py-2.5 text-body-sm font-semibold text-on-surface transition-colors hover:bg-surface-card"
            >
              Show more ({matching.length - shown} left)
            </button>
          )}
        </div>
      )}
    </div>
  );
}
