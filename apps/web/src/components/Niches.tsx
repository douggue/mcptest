import type { NicheList } from '@jgtube/core';
import { useState } from 'react';
import {
  NICHE_FILTERS,
  describeView,
  emptyNiches,
  filterNiches,
  type NicheFilter,
} from '../lib/niches';
import { Details } from './layout/Details';
import { Notice, ShowMore } from './layout/Notice';
import { Segmented } from './layout/Segmented';
import { SplitView, ViewPage } from './layout/SplitView';
import { ViewHeader } from './layout/ViewHeader';
import { NicheCard } from './NicheCard';
import { NicheSearch } from './NicheSearch';
import type { Niches as NichesData } from './useNiches';

const PAGE_SIZE = 6;

/** Starts a channel breakdown of a listed channel. */
type BreakDown = (channel: { readonly id: string; readonly title: string }) => void;

interface CardsProps {
  readonly list: NicheList;
  readonly filter: NicheFilter;
  readonly onSetWatched: (channelId: string, watched: boolean) => void;
  readonly onBreakDown: BreakDown | undefined;
}

/** The matching channels, in one column, a few at a time. */
function Cards({ list, filter, onSetWatched, onBreakDown }: CardsProps) {
  const [shown, setShown] = useState(PAGE_SIZE);
  const matching = filterNiches(list.channels, filter);
  if (matching.length === 0) return <Notice>{emptyNiches(list, filter)}</Notice>;
  return (
    <>
      <ul className="flex flex-col gap-space-md">
        {matching.slice(0, shown).map((channel) => (
          <li key={channel.id}>
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
      {matching.length > shown && (
        <ShowMore
          left={matching.length - shown}
          noun="channels"
          onClick={() => setShown((count) => count + PAGE_SIZE)}
        />
      )}
    </>
  );
}

interface SideProps {
  readonly niches: NichesData;
  readonly list: NicheList | null;
  readonly filter: NicheFilter;
}

/** The side panel: the keyword search, and how the list is made. */
function Side({ niches, list, filter }: SideProps) {
  const { state, search, discover } = niches;
  return (
    <>
      {state.status === 'ready' && (
        <NicheSearch canDiscover={state.canDiscover} search={search} onSearch={discover} />
      )}
      {list && (
        <Details summary="How this works">
          <p className="text-body-sm text-on-surface-variant">{describeView(list, filter)}</p>
        </Details>
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

/** New or small channels anywhere in the store with a video that took off, and the watched ones. */
export function Niches({ niches, hasMap, onBreakDown }: Props) {
  const [filter, setFilter] = useState<NicheFilter>('all');
  const { state, setWatched } = niches;
  const list = state.status === 'ready' ? state.list : null;
  const canDiscover = state.status === 'ready' && state.canDiscover;
  // With nothing read and no way to search, there is nothing to offer here yet.
  if (!hasMap && !canDiscover && (list === null || list.channels.length === 0)) return null;
  const count = list ? filterNiches(list.channels, filter).length : undefined;

  return (
    <ViewPage id="niches" labelledBy="niches-title">
      <SplitView
        sideLabel="The keyword search"
        width="narrow"
        mainFirst
        side={<Side niches={niches} list={list} filter={filter} />}
      >
        <ViewHeader
          titleId="niches-title"
          title="New niches"
          count={count}
          lead="New or small channels with a recent video far above their size or their usual views."
        />
        {list && list.channels.length > 0 && (
          <div className="flex min-w-0">
            <Segmented<NicheFilter>
              label="Which niches to show"
              options={NICHE_FILTERS.map((option) => ({ value: option.id, label: option.label }))}
              value={filter}
              onChange={setFilter}
            />
          </div>
        )}
        {state.status === 'loading' && (
          <Notice tone="working">Going through the channels read so far</Notice>
        )}
        {state.status === 'failed' && (
          <Notice tone="problem">The list could not be loaded: {state.message}</Notice>
        )}
        {state.status === 'ready' && state.problem && (
          <Notice tone="problem">Your choice was not saved: {state.problem}</Notice>
        )}
        {list && (
          <Cards
            key={filter}
            list={list}
            filter={filter}
            onSetWatched={setWatched}
            onBreakDown={onBreakDown}
          />
        )}
      </SplitView>
    </ViewPage>
  );
}
