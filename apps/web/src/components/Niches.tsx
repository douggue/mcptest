import type { NicheChannel, NicheList } from '@jgtube/core';
import { useState } from 'react';
import { applyFilters, clearFilters, type NicheFilterState } from '../lib/nicheFilters';
import { describeView, emptyNiches, filterNiches } from '../lib/niches';
import { Details } from './layout/Details';
import { Notice, ShowMore } from './layout/Notice';
import { Segmented } from './layout/Segmented';
import { ViewPage } from './layout/SplitView';
import { ViewHeader } from './layout/ViewHeader';
import { NicheCard } from './NicheCard';
import { NicheFilterBar } from './NicheFilterBar';
import type { NicheFilterModel } from './NicheFilterGroup';
import { NicheSearch } from './NicheSearch';
import { useMoney } from './useMoney';
import { useNicheFilters } from './useNicheFilters';
import type { Niches as NichesData } from './useNiches';

/** Four rows of three on a wide screen. */
const PAGE_SIZE = 12;

/** The channels not taken up yet, or the ones the owner saved. */
type NicheView = 'all' | 'watched';

/** Starts a channel breakdown of a listed channel. */
type BreakDown = (channel: { readonly id: string; readonly title: string }) => void;

interface CardsProps {
  readonly channels: readonly NicheChannel[];
  readonly onSetWatched: (channelId: string, watched: boolean) => void;
  readonly onBreakDown: BreakDown | undefined;
}

/** The matching channels: three in a row on a wide screen, two on a tablet, one on a phone. */
function Cards({ channels, onSetWatched, onBreakDown }: CardsProps) {
  const [shown, setShown] = useState(PAGE_SIZE);
  return (
    <>
      <ul className="grid min-w-0 grid-cols-1 gap-space-md sm:grid-cols-2 xl:grid-cols-3">
        {channels.slice(0, shown).map((channel) => (
          <li key={channel.id} className="flex min-w-0">
            <NicheCard
              channel={channel}
              onSetWatched={(watched) => onSetWatched(channel.id, watched)}
              onBreakDown={
                onBreakDown && (() => onBreakDown({ id: channel.id, title: channel.title }))
              }
            />
          </li>
        ))}
      </ul>
      {channels.length > shown && (
        <ShowMore
          left={channels.length - shown}
          noun="channels"
          onClick={() => setShown((count) => count + PAGE_SIZE)}
        />
      )}
    </>
  );
}

/** The keyword search, and how the list is made, under the cards. */
function Finder({
  niches,
  list,
  view,
}: {
  readonly niches: NichesData;
  readonly list: NicheList | null;
  readonly view: NicheView;
}) {
  const { state, search, discover } = niches;
  return (
    <aside
      aria-label="The keyword search"
      className="grid min-w-0 grid-cols-1 gap-space-lg rounded-lg border border-border-subtle bg-space-canvas p-space-md lg:grid-cols-2"
    >
      {state.status === 'ready' && (
        <NicheSearch canDiscover={state.canDiscover} search={search} onSearch={discover} />
      )}
      {list && (
        <Details summary="How this works">
          <p className="text-body-sm text-on-surface-variant">{describeView(list, view)}</p>
        </Details>
      )}
    </aside>
  );
}

/** The filter state with the list in view and the monetization verdicts read so far. */
function useFilterModel(channels: readonly NicheChannel[]): NicheFilterModel {
  const [state, update] = useNicheFilters();
  const { byId } = useMoney(channels.map((channel) => channel.id));
  const context = {
    now: new Date(),
    moneyOf: (id: string) => byId.get(id)?.status ?? 'not-checked',
  };
  return { channels, state, update, context };
}

/** A key that changes whenever what is shown does, so "Show more" starts again. */
const shownKey = (view: NicheView, state: NicheFilterState): string =>
  `${view}:${JSON.stringify(state)}`;

interface ResultsProps {
  readonly list: NicheList;
  readonly view: NicheView;
  readonly onView: (view: NicheView) => void;
  readonly onSetWatched: (channelId: string, watched: boolean) => void;
  readonly onBreakDown: BreakDown | undefined;
}

/** The view switch, the filters, and the cards they leave. */
function Results({ list, view, onView, onSetWatched, onBreakDown }: ResultsProps) {
  const inView = filterNiches(list.channels, view);
  const model = useFilterModel(inView);
  const matching = applyFilters(inView, model.state, model.context);
  const saved = filterNiches(list.channels, 'watched').length;
  return (
    <>
      <div className="flex min-w-0">
        <Segmented<NicheView>
          label="Which channels to show"
          options={[
            { value: 'all', label: `To look at (${list.channels.length - saved})` },
            { value: 'watched', label: `Saved (${saved})` },
          ]}
          value={view}
          onChange={onView}
        />
      </div>
      {inView.length > 0 && <NicheFilterBar model={model} shown={matching.length} />}
      {inView.length === 0 && <Notice>{emptyNiches(list, view)}</Notice>}
      {inView.length > 0 && matching.length === 0 && (
        <Notice>
          No channel matches these filters.{' '}
          <button
            type="button"
            className="font-semibold text-primary hover:underline"
            onClick={() => model.update(clearFilters)}
          >
            Clear filters
          </button>
        </Notice>
      )}
      {matching.length > 0 && (
        <Cards
          key={shownKey(view, model.state)}
          channels={matching}
          onSetWatched={onSetWatched}
          onBreakDown={onBreakDown}
        />
      )}
    </>
  );
}

interface Props {
  readonly niches: NichesData;
  /** A map is on screen. Without one, an empty list is not worth a view. */
  readonly hasMap: boolean;
  /** Starts a channel breakdown of a listed channel; absent when none can be started now. */
  readonly onBreakDown?: BreakDown | undefined;
}

/** New or small channels anywhere in the store with a video that took off, and the saved ones. */
export function Niches({ niches, hasMap, onBreakDown }: Props) {
  const [view, setView] = useState<NicheView>('all');
  const { state, setWatched } = niches;
  const list = state.status === 'ready' ? state.list : null;
  const canDiscover = state.status === 'ready' && state.canDiscover;
  // With nothing read and no way to search, there is nothing to offer here yet.
  if (!hasMap && !canDiscover && (list === null || list.channels.length === 0)) return null;
  const count = list ? filterNiches(list.channels, view).length : undefined;

  return (
    <ViewPage id="niches" labelledBy="niches-title">
      <ViewHeader
        titleId="niches-title"
        title="New niches"
        count={count}
        lead="New or small channels with a recent video far above their size or their usual views."
      />
      {state.status === 'loading' && (
        <Notice tone="working">Going through the channels read so far</Notice>
      )}
      {state.status === 'failed' && (
        <Notice tone="problem">The list could not be loaded: {state.message}</Notice>
      )}
      {state.status === 'ready' && state.problem && (
        <Notice tone="problem">Your choice was not saved: {state.problem}</Notice>
      )}
      {list && list.channels.length === 0 && <Notice>{emptyNiches(list, 'all')}</Notice>}
      {list && list.channels.length > 0 && (
        <Results
          list={list}
          view={view}
          onView={setView}
          onSetWatched={setWatched}
          onBreakDown={onBreakDown}
        />
      )}
      <Finder niches={niches} list={list} view={view} />
    </ViewPage>
  );
}
