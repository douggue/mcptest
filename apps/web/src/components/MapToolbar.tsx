import { PANEL_BUTTON } from './layout/PanelAction';
import { Download, Search } from 'lucide-react';
import type { FormEvent, KeyboardEvent } from 'react';
import type { JobState } from '../lib/api';
import { Field } from './layout/Card';
import { Details } from './layout/Details';
import { Segmented } from './layout/Segmented';
import { FIELD, QUIET_BUTTON } from './LabStatus';

const STAGE_LABEL: Readonly<Record<string, string>> = {
  'reading-recommendations': 'Reading recommendations',
  'reading-channels': 'Reading channels',
  done: 'Finishing',
};
const DEPTHS = [1, 2, 3] as const;
/** Channel limits on offer, with roughly how long a fresh map of that size takes. */
const SIZES = [
  { channels: 150, minutes: 5 },
  { channels: 300, minutes: 10 },
  { channels: 600, minutes: 20 },
] as const;

/** Find competitors is the screen's primary action only until a map exists; then the next step is. */
const SECONDARY =
  'flex min-h-11 w-full items-center justify-center gap-2 rounded border border-border-highlight px-4 text-body-md font-semibold text-on-surface transition-colors hover:bg-surface-card disabled:cursor-not-allowed disabled:opacity-60';

interface Props {
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
  /** The most channels the next map may hold. */
  readonly size: number;
  readonly onSizeChange: (size: number) => void;
  readonly onExport: (() => void) | null;
}

/** What the map being made is doing, or why the last one did not start. */
function Progress({ job, message }: Pick<Props, 'job' | 'message'>) {
  if (job?.status === 'running') {
    const progress = job.progress ?? null;
    const stage = progress ? (STAGE_LABEL[progress.stage] ?? 'Working') : 'Starting';
    return (
      <p role="status" className="flex items-center gap-2 text-body-sm text-on-surface">
        <span className="h-2 w-2 flex-none animate-pulse rounded-full bg-primary-container shadow-[0_0_8px_#00d2ff]" />
        {stage}
        {progress?.step ? ` · step ${progress.step}` : ''}
        {progress ? ` · ${progress.channels} channels` : ''}
      </p>
    );
  }
  if (!message) return null;
  return (
    <p role="alert" className="break-words text-body-sm text-error">
      {message}
    </p>
  );
}

/** How far out the next map reaches and how many channels it may hold. */
function MapSettings(props: Pick<Props, 'depth' | 'onDepthChange' | 'size' | 'onSizeChange'>) {
  const minutes = SIZES.find((option) => option.channels === props.size)?.minutes;
  return (
    <Details summary={`Map settings · L${props.depth} · ${props.size} channels`}>
      <Field label="Depth: steps out from your channel">
        <Segmented
          fill
          label="How many steps to follow"
          options={DEPTHS.map((depth) => ({ value: String(depth), label: `L${depth}` }))}
          value={String(props.depth)}
          onChange={(value) => props.onDepthChange(Number(value))}
        />
      </Field>
      <Field label="Size: most channels on the map">
        <Segmented
          fill
          label="How many channels the map may hold"
          options={SIZES.map((option) => ({
            value: String(option.channels),
            label: String(option.channels),
          }))}
          value={String(props.size)}
          onChange={(value) => props.onSizeChange(Number(value))}
        />
        {minutes && (
          <p className="text-body-sm text-on-surface-variant">
            About {minutes} minutes for a new map.
          </p>
        )}
      </Field>
    </Details>
  );
}

/**
 * The overview's side panel: which channel to map, the channel to be like,
 * the map settings behind a disclosure, the one button that makes the map,
 * its progress, and the export.
 */
export function MapToolbar(props: Props) {
  const running = props.job?.status === 'running';
  const submit = (event: FormEvent) => {
    event.preventDefault();
    props.onSubmit();
  };
  const onModelKey = (event: KeyboardEvent<HTMLInputElement>) => {
    // Enter also confirms text typed through an input method; that must not start a map.
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (!running) props.onSubmit();
  };

  return (
    <form onSubmit={submit} className="flex min-w-0 flex-col gap-space-lg">
      <div className="flex flex-col gap-1">
        <h3 className="text-headline-md font-bold text-on-surface">Add a channel</h3>
        <p className="text-body-sm text-on-surface-variant">
          Paste a channel to map who it competes with on YouTube.
        </p>
      </div>
      <Field label={<label htmlFor="channel-query">Your channel</label>}>
        <div className="relative">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-outline"
          />
          <input
            id="channel-query"
            type="text"
            value={props.query}
            onChange={(event) => props.onQueryChange(event.target.value)}
            placeholder="Handle or link"
            autoComplete="off"
            spellCheck={false}
            maxLength={200}
            className={`${FIELD} min-h-11 pl-11`}
          />
        </div>
      </Field>
      <Field label={<label htmlFor="model-query">Channel you want to be like (optional)</label>}>
        <input
          id="model-query"
          type="text"
          value={props.model}
          onChange={(event) => props.onModelChange(event.target.value)}
          onKeyDown={onModelKey}
          placeholder="@handle or link"
          autoComplete="off"
          spellCheck={false}
          maxLength={200}
          className={`${FIELD} min-h-11`}
        />
        {props.measuredAgainst && (
          <p className="text-body-sm text-primary-fixed-dim">
            This map is measured against {props.measuredAgainst}.
          </p>
        )}
      </Field>
      <MapSettings {...props} />
      <div className="flex flex-col gap-space-sm">
        <button
          type="submit"
          disabled={running || props.query.trim() === ''}
          className={props.onExport ? SECONDARY : PANEL_BUTTON}
        >
          {running ? 'Mapping…' : 'Find competitors'}
        </button>
        <Progress job={props.job} message={props.message} />
      </div>
      {props.onExport && (
        <button
          type="button"
          onClick={props.onExport}
          className={`flex items-center justify-center gap-1.5 ${QUIET_BUTTON}`}
        >
          <Download aria-hidden="true" className="h-4 w-4" />
          Download this map
        </button>
      )}
    </form>
  );
}
