import type { BreakoutVideo } from '@jgtube/core';
import { useState } from 'react';
import {
  NO_MAP_FILTERS,
  SCORE_FLOORS,
  activeMapFilters,
  applyMapFilters,
  gridBreakout,
  type MapFilters,
  type ScoreFloor,
} from '../../lib/videoViews';
import { Notice, ShowMore } from '../layout/Notice';
import { Popover } from '../layout/Popover';
import { MoneyFilter } from '../MoneyFilter';
import { EmptyState } from '../ui/States';
import { useMoneyFilter, useMoneyFiltered } from '../useMoney';
import { FilterBar, SaveView, SearchField, ShownLine, ToggleChip } from './FilterBar';
import { GridCard, SaveVideo } from './GridCard';

const PAGE_SIZE = 12;

/** The score floors as a short list in a chip's menu: one is chosen. */
function ScoreChip({
  value,
  onChange,
}: {
  readonly value: ScoreFloor;
  readonly onChange: (next: ScoreFloor) => void;
}) {
  const [open, setOpen] = useState(false);
  const chosen = SCORE_FLOORS.find((floor) => floor.id === value);
  return (
    <Popover
      label={value === 'any' ? 'Score' : (chosen?.label ?? 'Score')}
      active={value !== 'any'}
      open={open}
      onOpenChange={setOpen}
    >
      <fieldset className="flex min-w-0 flex-col gap-1">
        <legend className="mb-1 text-body-sm font-semibold text-ink">Outlier score</legend>
        {SCORE_FLOORS.map((floor) => (
          <label key={floor.id} className="flex min-h-9 items-center gap-2 text-body-sm text-muted">
            <input
              type="radio"
              name="score-floor"
              checked={floor.id === value}
              onChange={() => {
                onChange(floor.id);
                setOpen(false);
              }}
              className="h-4 w-4 accent-[#00D2FF]"
            />
            {floor.label}
          </label>
        ))}
      </fieldset>
    </Popover>
  );
}

/** The monetization filter of the breakouts, in a chip's menu. */
function EarningChip({ channelIds }: { readonly channelIds: readonly string[] }) {
  const [open, setOpen] = useState(false);
  const [value] = useMoneyFilter('breakouts');
  return (
    <Popover label="Earning" active={value !== 'any'} open={open} onOpenChange={setOpen}>
      <MoneyFilter view="breakouts" channelIds={channelIds} />
    </Popover>
  );
}

interface Props {
  /** The map's breakouts, in the order the map gives them: highest score first. */
  readonly items: readonly BreakoutVideo[];
  /** The filters the view opens with. */
  readonly initial: MapFilters;
  readonly centerTitle: string;
  /** The videos picked as inspiration for the idea lab, by id. */
  readonly pickedIds: readonly string[];
  readonly onPick: (item: BreakoutVideo) => void;
  /** Why a name cannot be used for a saved view, or null when it can. */
  readonly nameProblem: (name: string) => string | null;
  readonly onSaveView: (name: string, filters: MapFilters) => void;
  /** Removes the saved view on screen; absent on a built-in view. */
  readonly onRemoveView?: (() => void) | undefined;
}

/**
 * The grid over the map's breakouts: videos of the last 30 days far above
 * their channel's usual views, under the filters of the old Breaking out
 * list (score, small channels, monetization) and title words.
 */
export function MapGrid(props: Props) {
  const { items, initial, centerTitle, pickedIds, onPick } = props;
  const [filters, setFilters] = useState<MapFilters>(initial);
  const [shown, setShown] = useState(PAGE_SIZE);
  const [money, setMoney] = useMoneyFilter('breakouts');
  const matching = useMoneyFiltered(
    'breakouts',
    applyMapFilters(items, filters),
    (item) => item.channelId,
  );
  const change = (next: Partial<MapFilters>): void => {
    setFilters((now) => ({ ...now, ...next }));
    setShown(PAGE_SIZE);
  };
  const inUse = activeMapFilters(filters) + Number(money !== 'any');
  const clear = (): void => {
    setFilters(NO_MAP_FILTERS);
    setMoney('any');
    setShown(PAGE_SIZE);
  };
  return (
    <>
      <FilterBar label="Filter the videos">
        <SearchField
          label="Words in the title"
          placeholder="Search titles"
          value={filters.words}
          onChange={(words) => change({ words })}
        />
        <ScoreChip value={filters.score} onChange={(score) => change({ score })} />
        <ToggleChip on={filters.small} onToggle={() => change({ small: !filters.small })}>
          Channels under 10K
        </ToggleChip>
        <EarningChip channelIds={[...new Set(items.map((item) => item.channelId))]} />
        <SaveView
          problemOf={props.nameProblem}
          onSave={(name) => props.onSaveView(name, filters)}
        />
        <ShownLine
          text={`Showing ${matching.length} of ${items.length} · Highest score first`}
          onClear={inUse > 0 ? clear : undefined}
        />
      </FilterBar>
      <p className="text-body-sm text-dim">
        Last 30 days, far above their channel’s usual views, around {centerTitle}.
        {props.onRemoveView && (
          <>
            {' '}
            <button
              type="button"
              onClick={props.onRemoveView}
              className="rounded font-semibold text-link hover:underline"
            >
              Remove this view
            </button>
          </>
        )}
      </p>
      {items.length === 0 && (
        <EmptyState
          title="Nothing is breaking out yet"
          line="No video on this map is far enough above its channel’s usual views."
        />
      )}
      {items.length > 0 && matching.length === 0 && (
        <Notice>Nothing on this map matches these filters.</Notice>
      )}
      <ol className="grid min-w-0 grid-cols-1 gap-x-6 gap-y-8 sm:grid-cols-2 xl:grid-cols-3">
        {matching.slice(0, shown).map((item) => (
          <li key={item.videoId} className="min-w-0">
            <GridCard
              video={gridBreakout(item)}
              picked={pickedIds.includes(item.videoId)}
              onPick={() => onPick(item)}
              save={<SaveVideo videoId={item.videoId} />}
            />
          </li>
        ))}
      </ol>
      {matching.length > shown && (
        <ShowMore
          left={matching.length - shown}
          noun="videos"
          onClick={() => setShown((count) => count + PAGE_SIZE)}
        />
      )}
    </>
  );
}
