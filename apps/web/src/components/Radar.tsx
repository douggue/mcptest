import type { MapSnapshot } from '@jgtube/core';
import { Maximize, Minus, Plus } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { formatScore, initials } from '../lib/format';
import type { RadarLayout, RadarNode } from '../lib/radarLayout';

const STAGE_WIDTH = 1200;
const STAGE_HEIGHT = 620;
const ZOOM_STEPS = [0.7, 0.85, 1, 1.2, 1.45] as const;
const DEFAULT_ZOOM_INDEX = 2;

const NODE_SIZE: Readonly<Record<RadarNode['tier'], string>> = {
  close: 'h-14 w-14 text-body-md',
  medium: 'h-11 w-11 text-body-sm',
  far: 'h-9 w-9 text-[11px]',
};

/** Inner-ring nodes sit closest together, so their labels are cut shorter. */
const LABEL_WIDTH: Readonly<Record<RadarNode['tier'], string>> = {
  close: 'max-w-[100px]',
  medium: 'max-w-[130px]',
  far: 'max-w-[130px]',
};

interface Props {
  readonly snapshot: MapSnapshot | null;
  readonly layout: RadarLayout | null;
  readonly selectedId: string | null;
  readonly onSelect: (channelId: string) => void;
  /** Shown over the rings when there is no map to draw. */
  readonly emptyState: ReactNode;
  /** The details panel for the selected channel. */
  readonly children: ReactNode;
}

function Node({
  node,
  selected,
  onSelect,
}: {
  readonly node: RadarNode;
  readonly selected: boolean;
  readonly onSelect: () => void;
}) {
  const glow = selected
    ? 'ring-2 ring-primary-container shadow-[0_0_24px_rgba(0,210,255,0.55)]'
    : node.rising
      ? 'shadow-[0_0_20px_rgba(0,210,255,0.45)]'
      : 'shadow-md';
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={`${node.title}${node.badge ? `, best breakout ${formatScore(node.badge)}` : ''}${node.rising ? ', rising' : ''}`}
      style={{ left: STAGE_WIDTH / 2 + node.x, top: STAGE_HEIGHT / 2 + node.y }}
      className={`group absolute z-20 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-surface-card font-bold text-secondary transition-transform hover:z-30 hover:scale-110 ${NODE_SIZE[node.tier]} ${glow}`}
    >
      {initials(node.title)}
      {node.badge !== null && (
        <span className="absolute -right-3 -top-1.5 rounded-full bg-[#2a1f08] px-1.5 py-0.5 text-metric-badge text-metric-amber shadow-[0_0_8px_rgba(251,191,36,0.3)]">
          {formatScore(node.badge)}
        </span>
      )}
      <span
        className={`pointer-events-none absolute left-1/2 top-full mt-1 ${LABEL_WIDTH[node.tier]} -translate-x-1/2 truncate rounded-full bg-space-canvas/85 px-2 py-0.5 text-label-caps font-semibold ${
          selected ? 'text-on-surface' : 'text-on-surface-variant group-hover:text-on-surface'
        }`}
      >
        {node.title}
      </span>
    </button>
  );
}

/** The orbital map: you in the middle, competing channels on rings by closeness. */
export function Radar({ snapshot, layout, selectedId, onSelect, emptyState, children }: Props) {
  const [zoomIndex, setZoomIndex] = useState(DEFAULT_ZOOM_INDEX);
  const zoom = ZOOM_STEPS[zoomIndex] ?? 1;
  const centerId = snapshot?.center.id;

  return (
    <section
      aria-label="Competitor radar"
      className="relative h-[620px] w-full select-none overflow-hidden bg-space-deep"
    >
      <div
        className="absolute left-1/2 top-1/2 transition-transform duration-500 ease-out"
        style={{
          width: STAGE_WIDTH,
          height: STAGE_HEIGHT,
          transform: `translate(-50%, -50%) scale(${zoom})`,
        }}
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 flex items-center justify-center"
        >
          <div className="h-[840px] w-[840px] flex-none rounded-full border border-dashed border-radar-arc opacity-60" />
          <div className="absolute h-[560px] w-[560px] rounded-full border border-dashed border-radar-arc opacity-80" />
          <div className="absolute h-[280px] w-[280px] rounded-full border border-border-subtle" />
          <div
            className="absolute h-[560px] w-[560px] animate-[spin_12s_linear_infinite] rounded-full opacity-30"
            style={{
              background:
                'conic-gradient(from 0deg, rgba(0,210,255,0.4) 0deg, rgba(0,210,255,0.05) 45deg, transparent 60deg)',
            }}
          />
          <div className="absolute h-px w-full bg-gradient-to-r from-transparent via-radar-arc to-transparent" />
          <div className="absolute h-full w-px bg-gradient-to-b from-transparent via-radar-arc to-transparent" />
        </div>

        {snapshot && layout && (
          <>
            <svg
              aria-hidden="true"
              width={STAGE_WIDTH}
              height={STAGE_HEIGHT}
              viewBox={`${-STAGE_WIDTH / 2} ${-STAGE_HEIGHT / 2} ${STAGE_WIDTH} ${STAGE_HEIGHT}`}
              className="pointer-events-none absolute inset-0"
            >
              {layout.links.map((link) => {
                const direct = link.fromId === centerId;
                const active = selectedId === link.toId || selectedId === link.fromId;
                return (
                  <line
                    key={`${link.fromId}-${link.toId}`}
                    x1={link.x1}
                    y1={link.y1}
                    x2={link.x2}
                    y2={link.y2}
                    stroke={direct ? '#00d2ff' : '#38bdf8'}
                    strokeWidth={direct ? 1 + link.strength * 2 : 1}
                    strokeOpacity={active ? 0.95 : direct ? 0.2 + link.strength * 0.5 : 0.18}
                    strokeDasharray={direct ? undefined : '3 5'}
                    strokeLinecap="round"
                  />
                );
              })}
            </svg>

            <div
              style={{ left: STAGE_WIDTH / 2, top: STAGE_HEIGHT / 2 }}
              className="absolute z-30 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center"
            >
              <div className="relative flex h-16 w-16 items-center justify-center rounded-full bg-surface-card shadow-[0_0_32px_rgba(0,210,255,0.6)]">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-space-deep text-title-md font-bold text-primary-container">
                  {initials(snapshot.center.title)}
                </div>
                <span className="pointer-events-none absolute -inset-2 animate-ping rounded-full border border-primary-container/40" />
                <span className="pointer-events-none absolute -inset-3 rounded-full border border-primary-container/20" />
              </div>
              <div className="absolute top-full mt-2 flex items-center gap-1.5 whitespace-nowrap rounded-full bg-space-canvas/90 px-3 py-1 shadow-md">
                <span className="h-1.5 w-1.5 rounded-full bg-primary-container" />
                <span className="text-body-sm font-semibold text-on-surface">
                  {snapshot.center.title}
                </span>
              </div>
            </div>

            {layout.nodes.map((node) => (
              <Node
                key={node.id}
                node={node}
                selected={node.id === selectedId}
                onSelect={() => onSelect(node.id)}
              />
            ))}
          </>
        )}
      </div>

      {!snapshot && (
        <div className="absolute inset-0 z-30 flex items-center justify-center px-6 text-center">
          {emptyState}
        </div>
      )}

      <div className="absolute bottom-5 left-6 z-40 flex flex-col gap-2">
        <div className="flex w-fit flex-col overflow-hidden rounded bg-surface-card/90 p-1 shadow-xl backdrop-blur-md">
          <button
            type="button"
            aria-label="Zoom in"
            disabled={zoomIndex >= ZOOM_STEPS.length - 1}
            onClick={() => setZoomIndex((index) => Math.min(index + 1, ZOOM_STEPS.length - 1))}
            className="flex h-10 w-10 items-center justify-center rounded text-on-surface-variant transition-colors hover:bg-surface-container hover:text-on-surface disabled:opacity-40"
          >
            <Plus aria-hidden="true" className="h-[18px] w-[18px]" />
          </button>
          <button
            type="button"
            aria-label="Zoom out"
            disabled={zoomIndex <= 0}
            onClick={() => setZoomIndex((index) => Math.max(index - 1, 0))}
            className="flex h-10 w-10 items-center justify-center rounded text-on-surface-variant transition-colors hover:bg-surface-container hover:text-on-surface disabled:opacity-40"
          >
            <Minus aria-hidden="true" className="h-[18px] w-[18px]" />
          </button>
          <button
            type="button"
            aria-label="Reset zoom"
            onClick={() => setZoomIndex(DEFAULT_ZOOM_INDEX)}
            className="flex h-10 w-10 items-center justify-center rounded text-on-surface-variant transition-colors hover:bg-surface-container hover:text-on-surface"
          >
            <Maximize aria-hidden="true" className="h-[18px] w-[18px]" />
          </button>
        </div>
        <div className="flex items-center gap-3 rounded-full bg-surface-card/90 px-3 py-1.5 shadow-lg backdrop-blur-md">
          <span className="flex items-center gap-1.5 text-label-caps text-outline">
            <span className="h-0.5 w-3 rounded bg-primary-container" />
            Strong link
          </span>
          <span className="flex items-center gap-1.5 text-label-caps text-outline">
            <span className="h-2 w-2 rounded-full bg-primary-container shadow-[0_0_6px_#00d2ff]" />
            Rising
          </span>
          <span className="flex items-center gap-1.5 text-label-caps text-outline">
            <span className="h-2 w-2 rounded-full bg-metric-amber" />
            Breakout
          </span>
        </div>
      </div>

      {layout && layout.hidden > 0 && (
        <div className="absolute left-6 top-5 z-40 rounded-full bg-surface-card/90 px-3 py-1.5 text-label-caps text-outline shadow-lg backdrop-blur-md">
          +{layout.hidden} more channels in the list below
        </div>
      )}

      {children}
    </section>
  );
}
