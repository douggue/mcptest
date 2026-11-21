import type { TransferIdea, TransferList } from '@jgtube/core';
import { Globe } from 'lucide-react';
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
import { TransferCard } from './TransferCard';
import { TransferPlace } from './TransferPlace';
import type { Transfers as TransfersData } from './useTransfers';

const NOTE = 'rounded bg-surface-card p-space-lg text-body-md text-on-surface-variant';

interface FilterProps {
  /** The ideas, for the count on Saved; null until they are loaded. */
  readonly list: TransferList | null;
  readonly filter: TransferFilter;
  readonly onChange: (filter: TransferFilter) => void;
}

/** Switches between the opportunities, the title formats and the ideas the owner saved. */
function Filter({ list, filter, onChange }: FilterProps) {
  return (
    <div
      role="group"
      aria-label="Which ideas to show"
      className="flex flex-wrap items-center gap-1.5 pb-1 sm:flex-none sm:flex-nowrap"
    >
      {TRANSFER_FILTERS.map((option) => (
        <button
          key={option.id}
          type="button"
          aria-pressed={filter === option.id}
          onClick={() => onChange(option.id)}
          className={`whitespace-nowrap rounded-full px-3 py-1.5 text-label-caps transition-colors ${
            filter === option.id
              ? 'bg-surface-card font-semibold text-primary shadow-sm'
              : 'bg-surface-container text-on-surface-variant hover:bg-surface-card hover:text-on-surface'
          }`}
        >
          {filterLabel(option.id, list)}
        </button>
      ))}
    </div>
  );
}

interface CardsProps {
  readonly list: TransferList;
  readonly filter: TransferFilter;
  readonly onSetSaved: (key: string, saved: boolean) => void;
  readonly onMakeConcepts?: ((idea: TransferIdea) => void) | undefined;
}

/** The ideas or formats of the chosen view, a few at a time. */
function Cards({ list, filter, onSetSaved, onMakeConcepts }: CardsProps) {
  const [shown, setShown] = useState(TRANSFER_PAGE_SIZE);
  const ideas = ideasFor(list, filter);
  const formats = filter === 'formats' ? formatsFor(list) : [];
  const total = filter === 'formats' ? formats.length : ideas.length;
  if (total === 0) return <p className={NOTE}>{emptyTransfers(list, filter)}</p>;
  return (
    <div className="flex flex-col gap-space-md">
      <div className="grid grid-cols-1 gap-space-md xl:grid-cols-2">
        {filter === 'formats'
          ? formats.slice(0, shown).map((format) => <FormatCard key={format.key} format={format} />)
          : ideas
              .slice(0, shown)
              .map((idea) => (
                <TransferCard
                  key={idea.key}
                  idea={idea}
                  ownerPlace={list.ownerPlace}
                  onSetSaved={(saved) => onSetSaved(idea.key, saved)}
                  onMakeConcepts={onMakeConcepts && (() => onMakeConcepts(idea))}
                />
              ))}
      </div>
      {total > shown && (
        <button
          type="button"
          onClick={() => setShown((count) => count + TRANSFER_PAGE_SIZE)}
          className="self-center rounded-full bg-surface-container px-5 py-2.5 text-body-sm font-semibold text-on-surface transition-colors hover:bg-surface-card"
        >
          Show more {filter === 'formats' ? 'formats' : 'ideas'} ({total - shown} left)
        </button>
      )}
    </div>
  );
}

interface Props {
  readonly transfers: TransfersData;
  /** A map is on screen. Without one, an empty list is not worth a section. */
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

  return (
    <section
      aria-labelledby="transfers-title"
      className="w-full bg-space-deep px-gutter-desktop pb-space-xl"
    >
      <div className="mx-auto flex max-w-[1440px] flex-col gap-space-lg">
        <div className="flex flex-col justify-between gap-space-md pb-space-sm sm:flex-row sm:items-end">
          <div>
            <div className="flex items-center gap-2">
              <Globe aria-hidden="true" className="h-[22px] w-[22px] flex-none text-metric-amber" />
              <h2
                id="transfers-title"
                className="text-headline-lg font-bold tracking-tight text-on-surface"
              >
                Niche transfer opportunities
              </h2>
            </div>
            <p className="mt-1 max-w-4xl text-body-md text-on-surface-variant">
              {list
                ? describeTransfers(list)
                : 'Ideas that took off for another country and are untried or weak for yours, from the channels on this map.'}
            </p>
          </div>
          {hasAnything && <Filter list={list} filter={filter} onChange={setFilter} />}
        </div>

        {state.status === 'loading' && (
          <p role="status" className={`flex items-center gap-2 ${NOTE}`}>
            <span className="h-2 w-2 animate-pulse rounded-full bg-primary-container shadow-[0_0_8px_#00d2ff]" />
            Comparing the titles of the channels on this map
          </p>
        )}
        {state.status === 'failed' && (
          <p role="alert" className="rounded bg-surface-card p-space-lg text-body-md text-error">
            The list could not be loaded: {state.message}
          </p>
        )}
        {state.status === 'ready' && state.problem && (
          <p role="alert" className="rounded bg-surface-card p-space-lg text-body-md text-error">
            Your choice was not saved: {state.problem}
          </p>
        )}
        {list && state.status === 'ready' && (
          <TransferPlace
            list={state.list}
            countryNote={transfers.countryNote}
            onChoose={transfers.choosePlace}
          />
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
      </div>
    </section>
  );
}
