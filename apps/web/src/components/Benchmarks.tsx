import type { MapSnapshot } from '@jgtube/core';
import { Eye, Network } from 'lucide-react';
import { useState } from 'react';
import { formatCount, formatScore, initials } from '../lib/format';
import { GROUP_LABEL } from '../lib/mix';
import { TIER_LABEL } from './tiers';

const ROWS_SHOWN = 8;
const BADGE_MIN_SCORE = 2;

interface Props {
  readonly snapshot: MapSnapshot;
  readonly selectedId: string | null;
  readonly onSelect: (channelId: string) => void;
}

/** Every channel on the map as a list, plus a summary of the map itself. */
export function Benchmarks({ snapshot, selectedId, onSelect }: Props) {
  const [expanded, setExpanded] = useState(false);
  const channels = expanded ? snapshot.channels : snapshot.channels.slice(0, ROWS_SHOWN);
  const rising = snapshot.channels.filter((channel) => channel.rising).length;
  const crawled = new Date(snapshot.createdAt).toLocaleDateString('en', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  return (
    <div className="flex flex-col gap-space-lg xl:col-span-4">
      <div className="flex items-center justify-between pb-space-sm">
        <div className="flex items-center gap-2">
          <Network aria-hidden="true" className="h-5 w-5 text-primary" />
          <h2 className="text-title-md text-on-surface">Radar benchmarks</h2>
        </div>
        <span className="text-label-caps text-outline">{snapshot.channels.length} channels</span>
      </div>

      <div className="flex flex-col gap-3 rounded bg-surface-card p-space-md shadow-xl">
        {channels.map((channel) => {
          const score = channel.breakout?.score ?? 0;
          return (
            <div
              key={channel.id}
              className={`flex items-center justify-between gap-2 rounded p-2.5 transition-colors ${
                channel.id === selectedId
                  ? 'bg-surface-container ring-1 ring-border-highlight'
                  : 'bg-surface-container-low hover:bg-surface-container'
              }`}
            >
              <div className="flex min-w-0 items-center gap-space-sm">
                <div className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-space-deep text-xs font-bold text-secondary">
                  {initials(channel.title).charAt(0)}
                </div>
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-body-sm font-semibold text-on-surface">
                    {channel.title}
                  </span>
                  <span className="truncate text-label-caps text-outline">
                    {channel.peer && (
                      <span
                        className={
                          channel.group === 'neither' ? undefined : 'text-primary-fixed-dim'
                        }
                      >
                        {GROUP_LABEL[channel.group]} ·{' '}
                      </span>
                    )}
                    {TIER_LABEL[channel.tier]} · {formatCount(channel.subscribers)} subs
                  </span>
                </div>
              </div>
              <div className="flex flex-none items-center gap-1">
                {score >= BADGE_MIN_SCORE ? (
                  <span className="rounded-full bg-metric-amber-bg px-2 py-0.5 text-metric-badge text-metric-amber">
                    {formatScore(score)}
                  </span>
                ) : channel.rising && !channel.peer ? (
                  <span className="text-label-caps text-secondary">Rising</span>
                ) : null}
                <button
                  type="button"
                  onClick={() => onSelect(channel.id)}
                  aria-label={`Show ${channel.title} on the radar`}
                  className="flex h-9 w-9 items-center justify-center rounded-full text-outline hover:text-on-surface"
                >
                  <Eye aria-hidden="true" className="h-4 w-4" />
                </button>
              </div>
            </div>
          );
        })}
        {snapshot.channels.length > ROWS_SHOWN && (
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
            className="rounded-full bg-surface-container py-2.5 text-body-sm font-semibold text-on-surface transition-colors hover:bg-surface-container-high"
          >
            {expanded ? 'Show fewer' : `Show all ${snapshot.channels.length}`}
          </button>
        )}
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded bg-surface-card p-space-md shadow-xl">
        <div className="col-span-2 text-label-caps uppercase text-outline">This map</div>
        <div>
          <dt className="text-body-sm text-on-surface-variant">Channels shown</dt>
          <dd className="text-headline-md text-on-surface">{snapshot.channels.length}</dd>
        </div>
        <div>
          <dt className="text-body-sm text-on-surface-variant">Rising</dt>
          <dd className="text-headline-md text-primary">{rising}</dd>
        </div>
        <div>
          <dt className="text-body-sm text-on-surface-variant">Made on</dt>
          <dd className="text-body-md font-semibold text-on-surface">{crawled}</dd>
        </div>
        <div>
          <dt className="text-body-sm text-on-surface-variant">Depth and region</dt>
          <dd className="text-body-md font-semibold text-on-surface">
            L{snapshot.depth} · {snapshot.region}
          </dd>
        </div>
      </dl>
    </div>
  );
}
