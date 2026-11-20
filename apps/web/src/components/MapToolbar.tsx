import type { MapSnapshot } from '@jgtube/core';
import { Download, Globe, Layers, Search } from 'lucide-react';
import type { FormEvent } from 'react';
import type { JobState } from '../lib/api';

const STAGE_LABEL: Readonly<Record<string, string>> = {
  'reading-recommendations': 'Reading recommendations',
  'reading-channels': 'Reading channels',
  done: 'Finishing',
};
const DEPTHS = [1, 2] as const;

interface Props {
  readonly center: MapSnapshot['center'] | null;
  readonly query: string;
  readonly onQueryChange: (value: string) => void;
  /** A channel the owner wants to be like; optional. */
  readonly model: string;
  readonly onModelChange: (value: string) => void;
  /** The model channel the map on screen was measured against, if any. */
  readonly measuredAgainst: string | null;
  readonly onSubmit: () => void;
  readonly job: JobState | null;
  readonly message: string | null;
  readonly depth: number;
  readonly onDepthChange: (depth: number) => void;
  readonly onExport: (() => void) | null;
}

/** The bar above the radar: which channel, the search, crawl progress, depth and export. */
export function MapToolbar(props: Props) {
  const running = props.job?.status === 'running';
  const progress = props.job?.progress ?? null;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    props.onSubmit();
  };

  return (
    <section className="relative w-full bg-space-canvas px-gutter-desktop py-space-md shadow-lg">
      <div className="mx-auto flex max-w-[1440px] flex-col items-stretch justify-between gap-space-md xl:flex-row xl:items-center">
        <div className="flex flex-1 flex-wrap items-center gap-space-md">
          {props.center && (
            <div className="flex items-center gap-space-sm rounded-full bg-surface-card/90 px-space-md py-2 shadow-[0_2px_12px_rgba(0,0,0,0.5)]">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-container-high">
                <Globe aria-hidden="true" className="h-5 w-5 text-primary" />
              </div>
              <div className="flex flex-col">
                <span className="text-body-sm font-semibold leading-tight text-on-surface">
                  {props.center.title}
                </span>
                {props.center.handle && (
                  <span className="text-label-caps text-outline">@{props.center.handle}</span>
                )}
              </div>
            </div>
          )}
          <form onSubmit={submit} className="relative min-w-[280px] max-w-xl flex-1">
            <label htmlFor="channel-query" className="sr-only">
              Channel handle or link
            </label>
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-outline"
            />
            <input
              id="channel-query"
              type="text"
              value={props.query}
              onChange={(event) => props.onQueryChange(event.target.value)}
              placeholder="Paste your channel handle or link"
              autoComplete="off"
              spellCheck={false}
              maxLength={200}
              className="w-full rounded-full bg-surface-card py-2.5 pl-11 pr-40 text-body-sm text-on-surface placeholder-outline shadow-[inset_0_2px_6px_rgba(0,0,0,0.6)] focus:outline-none focus-visible:ring-1 focus-visible:ring-primary-container"
            />
            <button
              type="submit"
              disabled={running || props.query.trim() === ''}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-full bg-on-surface px-4 py-1.5 text-body-sm font-semibold text-space-deep shadow-[0_0_16px_rgba(0,210,255,0.35)] transition-all hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {running ? 'Mapping…' : 'Find competitors'}
            </button>
          </form>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <label htmlFor="model-query" className="text-label-caps text-outline">
              Channel you want to be like (optional)
            </label>
            <input
              id="model-query"
              type="text"
              value={props.model}
              onChange={(event) => props.onModelChange(event.target.value)}
              onKeyDown={(event) => {
                // Enter also confirms text typed through an input method; that must not start a map.
                if (event.key === 'Enter' && !event.nativeEvent.isComposing && !running) {
                  props.onSubmit();
                }
              }}
              placeholder="@handle or link"
              autoComplete="off"
              spellCheck={false}
              maxLength={200}
              className="min-w-0 flex-1 rounded-full bg-surface-card px-4 py-1.5 text-body-sm text-on-surface placeholder-outline shadow-[inset_0_2px_6px_rgba(0,0,0,0.6)] focus:outline-none focus-visible:ring-1 focus-visible:ring-primary-container"
            />
            {props.measuredAgainst && (
              <span className="text-label-caps text-primary-fixed-dim">
                This map is measured against {props.measuredAgainst}
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-space-sm xl:justify-end">
          {running && (
            <div
              role="status"
              className="flex items-center gap-2 rounded-full bg-surface-card/90 px-4 py-2 text-body-sm text-on-surface"
            >
              <span className="h-2 w-2 animate-pulse rounded-full bg-primary-container shadow-[0_0_8px_#00d2ff]" />
              {progress ? (STAGE_LABEL[progress.stage] ?? 'Working') : 'Starting'}
              {progress?.step ? (
                <span className="text-label-caps text-outline">step {progress.step}</span>
              ) : null}
              {progress && (
                <>
                  <span className="mx-1 h-4 w-px bg-surface-container-highest" />
                  <span className="text-metric-badge text-primary-fixed-dim">
                    {progress.channels} channels
                  </span>
                </>
              )}
            </div>
          )}
          {!running && props.message && (
            <div
              role="alert"
              className="max-w-md rounded-full bg-surface-card/90 px-4 py-2 text-body-sm text-error"
            >
              {props.message}
            </div>
          )}
          <div
            role="group"
            aria-label="How many steps to follow"
            className="hidden items-center gap-2 rounded-full bg-surface-card/90 px-3 py-1.5 sm:flex"
          >
            <Layers aria-hidden="true" className="h-4 w-4 text-outline" />
            <span className="text-label-caps uppercase text-outline">Depth</span>
            {DEPTHS.map((depth) => (
              <button
                key={depth}
                type="button"
                aria-pressed={props.depth === depth}
                onClick={() => props.onDepthChange(depth)}
                className={`rounded-full px-2.5 py-1 text-metric-badge transition-colors ${
                  props.depth === depth
                    ? 'bg-primary-container text-on-primary-container'
                    : 'text-on-surface-variant hover:text-on-surface'
                }`}
              >
                L{depth}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={props.onExport ?? undefined}
            disabled={!props.onExport}
            aria-label="Download this map as a file"
            className="rounded-full bg-surface-card p-2.5 text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Download aria-hidden="true" className="h-[18px] w-[18px]" />
          </button>
        </div>
      </div>
    </section>
  );
}
