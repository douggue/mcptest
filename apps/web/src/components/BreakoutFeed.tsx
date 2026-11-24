import { AddToFormat } from './AddToFormat';
import { MoneyBadge } from './MoneyBadge';
import { channelHref, videoHref } from '../lib/routes';
import type { BreakoutVideo } from '@jgtube/core';
import { Check, Plus, TrendingUp } from 'lucide-react';
import { useState } from 'react';
import {
  BREAKOUT_FILTERS,
  describeEvidence,
  filterBreakouts,
  type BreakoutFilter,
} from '../lib/feed';
import { formatCount, formatDuration, formatScore, thumbnailUrl } from '../lib/format';
import { Notice, ShowMore } from './layout/Notice';
import { Segmented } from './layout/Segmented';
import { ViewHeader } from './layout/ViewHeader';
import { CAUTION_LABEL } from './tiers';
import { MoneyFilter } from './MoneyFilter';
import { useMoneyFiltered } from './useMoney';

const PAGE_SIZE = 12;

interface CardProps {
  readonly item: BreakoutVideo;
  /** It is among the idea lab's picks. */
  readonly picked: boolean;
  /** Adds it to the idea lab's inspiration, or takes it out again. */
  readonly onPick: () => void;
  /** Starts a breakdown of its channel; absent while an AI run is under way. */
  readonly onBreakDown?: (() => void) | undefined;
}

/** Why the score is what it is, behind a small disclosure so the grid stays calm. */
function Evidence({ item }: { readonly item: BreakoutVideo }) {
  return (
    <details className="group/why min-w-0">
      <summary className="w-fit cursor-pointer list-none text-body-sm text-outline hover:text-on-surface [&::-webkit-details-marker]:hidden">
        Why {formatScore(item.score)}
        {item.caution ? ` · ${CAUTION_LABEL[item.caution].label.toLowerCase()}` : ''}
      </summary>
      <p className="mt-1 text-body-sm text-on-surface-variant">
        {describeEvidence(item)}
        {item.caution ? ` ${CAUTION_LABEL[item.caution].detail}` : ''}
      </p>
    </details>
  );
}

/** One video taking off, as a thumbnail tile: picture, title, channel and views, and Add to ideas. */
function BreakoutCard({ item, picked, onPick, onBreakDown }: CardProps) {
  const href = videoHref(item.videoId);
  const thumbnail = thumbnailUrl(item.videoId);
  const duration = formatDuration(item.durationSeconds);
  return (
    <article className="group flex min-w-0 flex-col gap-2">
      <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-surface-container-high">
        {thumbnail && (
          <img
            src={thumbnail}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        )}
        <span className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-space-deep/90 px-2 py-0.5 text-metric-badge text-metric-amber">
          <TrendingUp aria-hidden="true" className="h-3.5 w-3.5" />
          {formatScore(item.score)}
        </span>
        {duration && (
          <span className="absolute bottom-2 right-2 rounded bg-space-deep/90 px-1.5 py-0.5 text-body-sm font-semibold text-on-surface">
            {duration}
          </span>
        )}
      </div>
      <h3 className="line-clamp-2 text-body-md font-semibold text-on-surface transition-colors group-hover:text-primary">
        {href ? <a href={href}>{item.title}</a> : item.title}
      </h3>
      <p className="truncate text-body-sm text-on-surface-variant">
        <a
          href={channelHref(item.channelId)}
          className="font-semibold text-on-surface hover:text-primary hover:underline"
        >
          {item.channelTitle}
        </a>{' '}
        <MoneyBadge channelId={item.channelId} hideUnchecked /> · {formatCount(item.views)} views ·{' '}
        {item.publishedRaw}
      </p>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <Evidence item={item} />
        <div className="flex flex-none items-center gap-1">
          <AddToFormat
            source={{ kind: 'video', use: 'video', videoId: item.videoId, center: null }}
            iconOnly
          />
          {onBreakDown && (
            <button
              type="button"
              onClick={onBreakDown}
              className="flex min-h-10 items-center rounded-full px-3 text-body-sm font-semibold text-on-surface-variant transition-colors hover:bg-surface-card hover:text-on-surface"
            >
              Break down
            </button>
          )}
          <button
            type="button"
            aria-pressed={picked}
            onClick={onPick}
            className={`flex min-h-10 items-center gap-1.5 rounded-full px-3 text-body-sm font-semibold transition-colors ${
              picked
                ? 'text-primary hover:bg-surface-card'
                : 'text-on-surface-variant hover:bg-surface-card hover:text-on-surface'
            }`}
          >
            {picked ? (
              <Check aria-hidden="true" className="h-4 w-4" />
            ) : (
              <Plus aria-hidden="true" className="h-4 w-4" />
            )}
            {picked ? 'In ideas' : 'Add to ideas'}
          </button>
        </div>
      </div>
    </article>
  );
}

interface Props {
  readonly items: readonly BreakoutVideo[];
  readonly centerTitle: string;
  /** The videos picked as inspiration for the idea lab, by id. */
  readonly pickedIds: readonly string[];
  readonly onPick: (item: BreakoutVideo) => void;
  /** Starts a breakdown of a channel; absent while an AI run is under way. */
  readonly onBreakDown?:
    ((channel: { readonly id: string; readonly title: string }) => void) | undefined;
}

/** Recent videos across the map that are far above their channel's usual views. */
export function BreakoutFeed({ items, centerTitle, pickedIds, onPick, onBreakDown }: Props) {
  const [filter, setFilter] = useState<BreakoutFilter>('all');
  const [shown, setShown] = useState(PAGE_SIZE);
  const matching = useMoneyFiltered(
    'breakouts',
    filterBreakouts(items, filter),
    (item) => item.channelId,
  );
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
        lead={`Last 30 days, far above their channel’s usual views, around ${centerTitle}.`}
      />
      <div className="flex min-w-0">
        <Segmented<BreakoutFilter>
          label="Filter breakouts"
          options={BREAKOUT_FILTERS.map((option) => ({ value: option.id, label: option.label }))}
          value={filter}
          onChange={choose}
        />
      </div>
      <MoneyFilter
        view="breakouts"
        channelIds={[...new Set(items.map((item) => item.channelId))]}
      />
      {matching.length === 0 ? (
        <Notice>
          {items.length === 0
            ? 'No video on this map is far enough above its channel’s usual views yet.'
            : 'Nothing on this map matches that filter.'}
        </Notice>
      ) : (
        <ol className="grid grid-cols-1 gap-x-space-lg gap-y-space-xl sm:grid-cols-2 xl:grid-cols-3">
          {matching.slice(0, shown).map((item) => (
            <li key={item.videoId}>
              <BreakoutCard
                item={item}
                picked={pickedIds.includes(item.videoId)}
                onPick={() => onPick(item)}
                onBreakDown={
                  onBreakDown &&
                  (() => onBreakDown({ id: item.channelId, title: item.channelTitle }))
                }
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
