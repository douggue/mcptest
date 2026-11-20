import type { NicheList } from '@jgtube/core';
import { Sprout } from 'lucide-react';
import { useState } from 'react';
import { NICHE_FILTERS, describeList, filterNiches, type NicheFilter } from '../lib/niches';
import { NicheCard } from './NicheCard';
import type { Niches as NichesData } from './useNiches';

const PAGE_SIZE = 6;
const NOTE = 'rounded bg-surface-card p-space-lg text-body-md text-on-surface-variant';

const NO_MATCH: Readonly<Record<Exclude<NicheFilter, 'all'>, string>> = {
  new: 'None of the channels listed is new.',
  small: 'None of the channels listed is small.',
  watched: 'You are not watching any channel yet. Press Watch on one to keep it here.',
};

/** Why nothing is listed, in the owner's terms. */
function emptyText(list: NicheList, filter: NicheFilter): string {
  if (filter !== 'all' && list.channels.length > 0) return NO_MATCH[filter];
  if (list.channelsChecked === 0) {
    return 'Nothing has been read yet. Make a map and the new and small channels found along the way are listed here.';
  }
  return `None of the ${list.channelsChecked} channels read so far is a new or small channel with a recent video that took off. A larger map reads more channels.`;
}

interface FilterProps {
  readonly filter: NicheFilter;
  readonly onChange: (filter: NicheFilter) => void;
}

/** Narrows the list to the new channels, the small ones, or the ones the owner is watching. */
function Filter({ filter, onChange }: FilterProps) {
  return (
    <div
      role="group"
      aria-label="Which niches to show"
      className="flex flex-wrap items-center gap-1.5 pb-1 sm:flex-none sm:flex-nowrap"
    >
      {NICHE_FILTERS.map((option) => (
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
          {option.label}
        </button>
      ))}
    </div>
  );
}

interface CardsProps {
  readonly list: NicheList;
  readonly filter: NicheFilter;
  readonly onSetWatched: (channelId: string, watched: boolean) => void;
}

/** The matching channels, a few at a time. */
function Cards({ list, filter, onSetWatched }: CardsProps) {
  const [shown, setShown] = useState(PAGE_SIZE);
  const matching = filterNiches(list.channels, filter);
  if (matching.length === 0) return <p className={NOTE}>{emptyText(list, filter)}</p>;
  return (
    <div className="flex flex-col gap-space-md">
      <div className="grid grid-cols-1 gap-space-md xl:grid-cols-2">
        {matching.slice(0, shown).map((channel) => (
          <NicheCard
            key={channel.id}
            channel={channel}
            onSetWatched={(watched) => onSetWatched(channel.id, watched)}
          />
        ))}
      </div>
      {matching.length > shown && (
        <button
          type="button"
          onClick={() => setShown((count) => count + PAGE_SIZE)}
          className="self-center rounded-full bg-surface-container px-5 py-2.5 text-body-sm font-semibold text-on-surface transition-colors hover:bg-surface-card"
        >
          Show more channels ({matching.length - shown} left)
        </button>
      )}
    </div>
  );
}

interface Props {
  readonly niches: NichesData;
  /** A map is on screen. Without one, an empty list is not worth a section. */
  readonly hasMap: boolean;
}

/** New or small channels anywhere in the store with a video that took off, and the watched ones. */
export function Niches({ niches, hasMap }: Props) {
  const [filter, setFilter] = useState<NicheFilter>('all');
  const { state, setWatched } = niches;
  const list = state.status === 'ready' ? state.list : null;
  if (!hasMap && (list === null || list.channels.length === 0)) return null;

  return (
    <section
      aria-labelledby="niches-title"
      className="w-full bg-space-deep px-gutter-desktop pb-space-xl"
    >
      <div className="mx-auto flex max-w-[1440px] flex-col gap-space-lg">
        <div className="flex flex-col justify-between gap-space-md pb-space-sm sm:flex-row sm:items-end">
          <div>
            <div className="flex items-center gap-2">
              <Sprout aria-hidden="true" className="h-[22px] w-[22px] text-metric-amber" />
              <h2
                id="niches-title"
                className="text-headline-lg font-bold tracking-tight text-on-surface"
              >
                New niches to watch
              </h2>
            </div>
            <p className="mt-1 text-body-md text-on-surface-variant">
              {list
                ? describeList(list)
                : 'New or small channels with a recent video that took off, from every channel Jgtube has read.'}
            </p>
          </div>
          {list && list.channels.length > 0 && <Filter filter={filter} onChange={setFilter} />}
        </div>

        {state.status === 'loading' && (
          <p role="status" className={`flex items-center gap-2 ${NOTE}`}>
            <span className="h-2 w-2 animate-pulse rounded-full bg-primary-container shadow-[0_0_8px_#00d2ff]" />
            Going through the channels read so far
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
        {list && <Cards key={filter} list={list} filter={filter} onSetWatched={setWatched} />}
      </div>
    </section>
  );
}
