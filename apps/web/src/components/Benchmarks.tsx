import type { MapSnapshot } from '@jgtube/core';
import { useState } from 'react';
import { formatCount, formatScore } from '../lib/format';
import { GROUP_LABEL } from '../lib/mix';
import { ChannelLogo } from './ChannelLogo';
import { Field } from './layout/Card';
import { Details } from './layout/Details';
import { StatTile } from './layout/StatTile';
import { TIER_LABEL } from './tiers';

const ROWS_SHOWN = 8;
const BADGE_MIN_SCORE = 2;

type MapChannel = MapSnapshot['channels'][number];

interface Props {
  readonly snapshot: MapSnapshot;
  readonly selectedId: string | null;
  /** Opens the channel's own view. */
  readonly onSelect: (channelId: string) => void;
}

/** The line under a channel's name: its group when it is like yours, its ring and its size. */
function rowLine(channel: MapChannel): string {
  const group = channel.peer ? `${GROUP_LABEL[channel.group]} · ` : '';
  return `${group}${TIER_LABEL[channel.tier]} · ${formatCount(channel.subscribers)} subs`;
}

interface RowProps {
  readonly channel: MapChannel;
  readonly selected: boolean;
  readonly onSelect: () => void;
}

/** One channel on the map: logo, name, its place, and its best breakout in amber. */
function Row({ channel, selected, onSelect }: RowProps) {
  const score = channel.breakout?.score ?? 0;
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? 'true' : undefined}
        className="flex w-full min-w-0 items-center gap-space-sm rounded-lg p-1.5 text-left transition-colors hover:bg-surface-container"
      >
        <span className="flex h-10 w-10 flex-none items-center justify-center overflow-hidden rounded-full bg-surface-container-high text-xs font-bold text-secondary ring-2 ring-border-subtle">
          <ChannelLogo title={channel.title} logoUrl={channel.logoUrl} letters={1} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-body-md text-on-surface">{channel.title}</span>
          <span className="truncate text-body-sm text-on-surface-variant">{rowLine(channel)}</span>
        </span>
        {score >= BADGE_MIN_SCORE ? (
          <span className="flex-none rounded-full bg-metric-amber-bg px-2 py-0.5 text-metric-badge text-metric-amber">
            {formatScore(score)}
          </span>
        ) : channel.group === 'rising' && !channel.peer ? (
          <span className="flex-none text-label text-secondary">Rising</span>
        ) : null}
      </button>
    </li>
  );
}

/** The map's own numbers, each with what it is. */
function MapNumbers({ snapshot }: { readonly snapshot: MapSnapshot }) {
  // The same meaning of rising as the labels on the rows and the split under the radar.
  const rising = snapshot.channels.filter((channel) => channel.group === 'rising').length;
  const crawled = new Date(snapshot.createdAt).toLocaleDateString('en', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  return (
    <dl className="grid grid-cols-2 gap-2">
      <StatTile label="Channels" value={snapshot.channels.length} note="on this map" />
      <StatTile label="Rising" value={rising} note="young and far above their size" />
      <StatTile label="Made on" value={<span className="text-title-md">{crawled}</span>} />
      <StatTile
        label="Depth, region"
        value={<span className="text-title-md">{`L${snapshot.depth} · ${snapshot.region}`}</span>}
      />
    </dl>
  );
}

/** The map in brief, then every channel on it behind a disclosure; a channel opens its view. */
export function Benchmarks({ snapshot, selectedId, onSelect }: Props) {
  const [expanded, setExpanded] = useState(false);
  const channels = expanded ? snapshot.channels : snapshot.channels.slice(0, ROWS_SHOWN);
  return (
    <>
      <Field label="This map">
        <MapNumbers snapshot={snapshot} />
      </Field>
      <Details summary={`Channels on this map (${snapshot.channels.length})`}>
        <ul className="flex flex-col gap-1">
          {channels.map((channel) => (
            <Row
              key={channel.id}
              channel={channel}
              selected={channel.id === selectedId}
              onSelect={() => onSelect(channel.id)}
            />
          ))}
        </ul>
        {snapshot.channels.length > ROWS_SHOWN && (
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
            className="min-h-10 rounded-full bg-surface-container px-4 text-body-sm font-semibold text-on-surface transition-colors hover:bg-surface-container-high"
          >
            {expanded ? 'Show fewer' : `Show all ${snapshot.channels.length}`}
          </button>
        )}
      </Details>
    </>
  );
}
