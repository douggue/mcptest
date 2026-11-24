import type { TransferIdea, TransferList } from '@jgtube/core';
import { useState } from 'react';
import {
  describeTransfers,
  emptyTransfers,
  filterLabel,
  formatsFor,
  ideasFor,
  TRANSFER_FILTERS,
  TRANSFER_PAGE_SIZE,
  type TransferFilter,
} from '../lib/transfers';
import { FormatCard } from './FormatCard';
import { Details } from './layout/Details';
import { Notice, ShowMore } from './layout/Notice';
import { Segmented } from './layout/Segmented';
import { SplitView, ViewPage } from './layout/SplitView';
import { ViewHeader } from './layout/ViewHeader';
import { TransferCard } from './TransferCard';
import { TransferPlace } from './TransferPlace';
import type { Transfers as TransfersData } from './useTransfers';

interface CardsProps {
  readonly list: TransferList;
  readonly filter: TransferFilter;
  readonly onSetSaved: (key: string, saved: boolean) => void;
  readonly onMakeConcepts?: ((idea: TransferIdea) => void) | undefined;
}

/** The ideas or formats of the chosen view, in one column, a few at a time. */
function Cards({ list, filter, onSetSaved, onMakeConcepts }: CardsProps) {
  const [shown, setShown] = useState(TRANSFER_PAGE_SIZE);
  const ideas = ideasFor(list, filter);
  const formats = filter === 'formats' ? formatsFor(list) : [];
  const total = filter === 'formats' ? formats.length : ideas.length;
  if (total === 0) return <Notice>{emptyTransfers(list, filter)}</Notice>;
  return (
    <>
      <ul className="flex flex-col gap-space-md">
        {filter === 'formats'
          ? formats.slice(0, shown).map((format) => (
              <li key={format.key}>
                <FormatCard format={format} />
              </li>
            ))
          : ideas.slice(0, shown).map((idea) => (
              <li key={idea.key}>
                <TransferCard
                  idea={idea}
                  ownerPlace={list.ownerPlace}
                  onSetSaved={(saved) => onSetSaved(idea.key, saved)}
                  onMakeConcepts={onMakeConcepts && (() => onMakeConcepts(idea))}
                />
              </li>
            ))}
      </ul>
      {total > shown && (
        <ShowMore
          left={total - shown}
          noun={filter === 'formats' ? 'formats' : 'ideas'}
          onClick={() => setShown((count) => count + TRANSFER_PAGE_SIZE)}
        />
      )}
    </>
  );
}

interface SideProps {
  readonly transfers: TransfersData;
  readonly list: TransferList;
}

/** The side panel: what to show, the place the ideas are judged for, and how the list is made. */
function Side({ transfers, list }: SideProps) {
  const { state } = transfers;
  return (
    <>
      {state.status === 'ready' && (
        <TransferPlace
          list={state.list}
          countryNote={transfers.countryNote}
          onChoose={transfers.choosePlace}
        />
      )}
      <Details summary="How this works">
        <p className="text-body-sm text-on-surface-variant">{describeTransfers(list)}</p>
      </Details>
    </>
  );
}

interface Props {
  readonly transfers: TransfersData;
  /** A map is on screen. Without one, an empty list is not worth a view. */
  readonly hasMap: boolean;
  /** Takes an idea into the idea lab as inspiration and format; absent with no map. */
  readonly onMakeConcepts?: ((idea: TransferIdea) => void) | undefined;
}

/**
 * Ideas that several channels made as one title for different countries, with
 * the verdict for the owner's country, and the title formats that move
 * between subjects.
 */
export function Transfers({ transfers, hasMap, onMakeConcepts }: Props) {
  const [filter, setFilter] = useState<TransferFilter>('opportunities');
  const { state, setSaved } = transfers;
  const list = state.status === 'ready' ? state.list : null;
  const hasAnything = list !== null && (list.ideas.length > 0 || list.formats.length > 0);
  // With nothing read yet there is nothing to compare, and nothing to offer here.
  if (!hasMap && !hasAnything) return null;

  const main = (
    <>
      <ViewHeader
        titleId="transfers-title"
        title="Other languages"
        lead="Ideas that took off for another country and are untried or weak for yours."
      />
      {list && (
        <div className="flex min-w-0">
          <Segmented<TransferFilter>
            label="Which ideas to show"
            options={TRANSFER_FILTERS.map((option) => ({
              value: option.id,
              label: filterLabel(option.id, list),
            }))}
            value={filter}
            onChange={setFilter}
          />
        </div>
      )}
      {state.status === 'loading' && (
        <Notice tone="working">Comparing the titles of the channels on this map</Notice>
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
          onSetSaved={setSaved}
          onMakeConcepts={onMakeConcepts}
        />
      )}
    </>
  );

  return (
    <ViewPage id="transfers" labelledBy="transfers-title">
      {list ? (
        <SplitView
          sideLabel="Your place"
          width="narrow"
          mainFirst
          side={<Side transfers={transfers} list={list} />}
        >
          {main}
        </SplitView>
      ) : (
        main
      )}
    </ViewPage>
  );
}
