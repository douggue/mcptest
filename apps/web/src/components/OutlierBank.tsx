import type { BankVideo } from '@jgtube/core';
import { useState } from 'react';
import { BankCard } from './BankCard';
import { BankCollections } from './BankCollections';
import { BankFilterBar } from './BankFilterBar';
import { BankFind } from './BankFind';
import { Notice, ShowMore } from './layout/Notice';
import { ViewHeader } from './layout/ViewHeader';
import { useBank } from './useBank';

interface Props {
  /** The videos picked as inspiration for the idea lab, by id. */
  readonly pickedIds: readonly string[];
  readonly onPick: (video: BankVideo) => void;
}

/**
 * Research → Outlier bank: every stored video from every map, saved channel,
 * niche list, pasted channel and refresh, scored the usual way, with the New
 * niches filters, collections, and a way to grow it.
 */
export function OutlierBank({ pickedIds, onPick }: Props) {
  const model = useBank();
  const [finding, setFinding] = useState(false);
  const { page, videos } = model;
  const left = page ? page.matched - videos.length : 0;
  return (
    <>
      <ViewHeader
        titleId="outlier-bank-title"
        title="Outlier bank"
        count={page ? page.total.toLocaleString('en') : undefined}
        lead="Every video Jgtube has read, on every map and list, scored against its own channel."
        actions={
          <button
            type="button"
            aria-expanded={finding}
            onClick={() => setFinding((open) => !open)}
            className="min-h-11 rounded-full bg-on-surface px-4 text-body-sm font-semibold text-space-deep hover:bg-white"
          >
            {finding ? 'Close' : 'Find more outliers'}
          </button>
        }
      />
      {finding && <BankFind onGrown={model.reload} />}
      <BankFilterBar model={model} />
      <BankCollections model={model} />
      {model.problem && <Notice tone="problem">{model.problem}</Notice>}
      {page && videos.length === 0 && !model.loading && (
        <Notice>
          {page.total === 0
            ? 'The bank is empty: make a map on Home, or press Find more outliers.'
            : 'Nothing in the bank matches these filters.'}
        </Notice>
      )}
      <ol className="grid grid-cols-1 gap-x-space-lg gap-y-space-xl sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        {videos.map((video) => (
          <li key={video.videoId} className="min-w-0">
            <BankCard
              video={video}
              picked={pickedIds.includes(video.videoId)}
              onPick={() => onPick(video)}
              collections={model.collections}
              inCollections={model.savedOf(video.videoId)}
              onSaved={(collections, ids) => {
                model.setCollections(collections);
                model.setSaved(video.videoId, ids);
              }}
            />
          </li>
        ))}
      </ol>
      {left > 0 && <ShowMore left={left} noun="outliers" onClick={model.more} />}
    </>
  );
}
