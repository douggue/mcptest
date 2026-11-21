import type { BreakoutVideo } from '@jgtube/core';
import { TrendingUp } from 'lucide-react';
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
import { Card } from './layout/Card';
import { Notice, ShowMore } from './layout/Notice';
import { Segmented } from './layout/Segmented';
import { ViewHeader } from './layout/ViewHeader';
import { CAUTION_LABEL } from './tiers';

const PAGE_SIZE = 8;

interface CardProps {
  readonly item: BreakoutVideo;
  /** It is among the idea lab's picks. */
  readonly picked: boolean;
  /** Adds it to the idea lab's inspiration, or takes it out again. */
  readonly onPick: () => void;
}

function BreakoutCard({ item, picked, onPick }: CardProps) {
  const href = watchUrl(item.videoId);
  const thumbnail = thumbnailUrl(item.videoId);
  const duration = formatDuration(item.durationSeconds);
  return (
    <Card as="article" className="group sm:flex-row sm:items-start">
      <div className="relative aspect-video w-full flex-shrink-0 overflow-hidden rounded-lg bg-surface-container-high sm:w-60">
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
          <span className="absolute bottom-2 right-2 rounded bg-space-deep/90 px-1.5 py-0.5 text-label font-semibold text-on-surface">
            {duration}
          </span>
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-space-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1 rounded-full bg-metric-amber-bg px-2 py-0.5 text-metric-badge text-metric-amber">
            <TrendingUp aria-hidden="true" className="h-3.5 w-3.5" />
            {formatScore(item.score)}
          </span>
          {item.caution && (
            <span
              title={CAUTION_LABEL[item.caution].detail}
              className="rounded-full bg-surface-container-high px-2 py-0.5 text-label text-on-surface-variant"
            >
              {CAUTION_LABEL[item.caution].label}
            </span>
          )}
          <span className="text-body-sm text-on-surface-variant">
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
        <div className="flex min-w-0 items-center gap-2 text-body-sm text-on-surface-variant">
          <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-surface-container-high text-[11px] font-bold text-outline">
            {initials(item.channelTitle).charAt(0)}
          </span>
          <span className="truncate">{item.channelTitle}</span>
          <span className="flex-none text-outline">
            · {formatCount(item.channelSubscribers)} subscribers
          </span>
        </div>
        <p className="text-body-sm text-outline">{describeEvidence(item)}</p>
        <button
          type="button"
          aria-pressed={picked}
          onClick={onPick}
          className={`mt-1 min-h-9 self-start rounded-full px-4 text-body-sm font-semibold transition-colors ${
            picked
              ? 'bg-primary-container text-on-primary hover:opacity-90'
              : 'bg-surface-container-high text-primary hover:bg-surface-container-highest'
          }`}
        >
          {picked ? 'Picked as inspiration' : 'Use as inspiration'}
        </button>
      </div>
    </Card>
  );
}

interface Props {
  readonly items: readonly BreakoutVideo[];
  readonly centerTitle: string;
  /** The videos picked as inspiration for the idea lab, by id. */
  readonly pickedIds: readonly string[];
  readonly onPick: (item: BreakoutVideo) => void;
}

/** Recent videos across the map that are far above their channel's usual views. */
export function BreakoutFeed({ items, centerTitle, pickedIds, onPick }: Props) {
  const [filter, setFilter] = useState<BreakoutFilter>('all');
  const [shown, setShown] = useState(PAGE_SIZE);
  const matching = filterBreakouts(items, filter);
  const choose = (next: BreakoutFilter) => {
    setFilter(next);
    setShown(PAGE_SIZE);
  };

  return (
    <>
      <ViewHeader
        titleId="breakouts-title"
        title="Breaking out"
        count={matching.length}
        lead={`Videos from the last 30 days far above their channel’s usual views, around ${centerTitle}.`}
      />
      <div className="flex min-w-0">
        <Segmented<BreakoutFilter>
          label="Filter breakouts"
          options={BREAKOUT_FILTERS.map((option) => ({ value: option.id, label: option.label }))}
          value={filter}
          onChange={choose}
        />
      </div>
      {matching.length === 0 ? (
        <Notice>
          {items.length === 0
            ? 'No video on this map is far enough above its channel’s usual views yet.'
            : 'Nothing on this map matches that filter.'}
        </Notice>
      ) : (
        <ol className="flex flex-col gap-space-md">
          {matching.slice(0, shown).map((item) => (
            <li key={item.videoId}>
              <BreakoutCard
                item={item}
                picked={pickedIds.includes(item.videoId)}
                onPick={() => onPick(item)}
              />
            </li>
          ))}
        </ol>
      )}
      {matching.length > shown && (
        <ShowMore
          left={matching.length - shown}
          onClick={() => setShown((count) => count + PAGE_SIZE)}
        />
      )}
    </>
  );
}
