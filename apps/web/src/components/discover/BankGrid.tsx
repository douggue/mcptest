import type { BankCollection, BankVideo } from '@jgtube/core';
import type { BankFilterState } from '@jgtube/core/src/bank/query';
import { Download, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { createBankApi, exportHref } from '../../lib/bank';
import { viewHref } from '../../lib/routes';
import { gridBankVideo } from '../../lib/videoViews';
import { BankFilterBar } from '../BankFilterBar';
import { BankFind } from '../BankFind';
import { BankSave } from '../BankSave';
import { Notice, ShowMore } from '../layout/Notice';
import { Button, buttonClass } from '../ui/Button';
import { EmptyState } from '../ui/States';
import { useBank } from '../useBank';
import { SaveView, ToggleChip } from './FilterBar';
import { GridCard } from './GridCard';

interface ToolsProps {
  readonly collection: BankCollection;
  /** Told when the collection is gone, so the row of views drops it. */
  readonly onDeleted: (collections: readonly BankCollection[]) => void;
}

/** A collection's own tools: its two exports, and the way to delete it. */
function CollectionTools({ collection, onDeleted }: ToolsProps) {
  const api = useMemo(() => createBankApi(), []);
  const [problem, setProblem] = useState<string | null>(null);
  const remove = (): void => {
    const sure = window.confirm(
      `Delete the collection “${collection.name}”? The videos stay in the bank.`,
    );
    if (!sure) return;
    api
      .deleteCollection(collection.id)
      .then(onDeleted, (error: unknown) =>
        setProblem(error instanceof Error ? error.message : 'It could not be deleted'),
      );
  };
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <p className="mr-auto min-w-0 text-body-sm text-dim">
        Your collection “{collection.name}”. Save a video to it from any card.
      </p>
      <a href={exportHref(collection.id, 'csv')} download className={buttonClass('second', true)}>
        <Download aria-hidden="true" className="h-4 w-4" />
        Export CSV
      </a>
      <a href={exportHref(collection.id, 'md')} download className={buttonClass('second', true)}>
        <Download aria-hidden="true" className="h-4 w-4" />
        Export Markdown
      </a>
      <Button small icon={Trash2} onClick={remove}>
        Delete collection
      </Button>
      {problem && (
        <p role="alert" className="basis-full text-body-sm text-bad">
          {problem}
        </p>
      )}
    </div>
  );
}

interface Props {
  /** The filters the view opens with; left out, the bank opens with the ones last used. */
  readonly initial?: BankFilterState | undefined;
  /** The collection the view is of, with its tools; null for any other view. */
  readonly collection: BankCollection | null;
  /** The videos picked as inspiration for the idea lab, by id. */
  readonly pickedIds: readonly string[];
  readonly onPick: (video: BankVideo) => void;
  /** Told when the owner's collections changed, so the row of views follows. */
  readonly onCollections: (collections: readonly BankCollection[]) => void;
  /** Told how many videos the bank holds in all, once read. */
  readonly onTotal: (total: number) => void;
  /** Why a name cannot be used for a saved view, or null when it can. */
  readonly nameProblem: (name: string) => string | null;
  readonly onSaveView: (name: string, filters: BankFilterState) => void;
  /** Removes the saved view on screen; absent on a built-in view. */
  readonly onRemoveView?: (() => void) | undefined;
}

/**
 * The grid over the bank: every video Jgtube has read, on every map and
 * list, each scored against its own channel, under the bank's filters. The
 * same bank as before, asked the same way; "Find more" grows it by keyword.
 */
export function BankGrid(props: Props) {
  const { initial, collection, pickedIds, onPick, onCollections } = props;
  const model = useBank(initial === undefined ? {} : { initial });
  const [finding, setFinding] = useState(false);
  const { page, videos } = model;
  const left = page ? page.matched - videos.length : 0;
  const total = page?.total ?? null;
  const { onTotal } = props;
  useEffect(() => {
    if (total !== null) onTotal(total);
  }, [total, onTotal]);
  return (
    <>
      <BankFilterBar
        model={model}
        extras={
          <>
            <ToggleChip on={finding} onToggle={() => setFinding((open) => !open)}>
              Find more by keyword
            </ToggleChip>
            <SaveView
              problemOf={props.nameProblem}
              onSave={(name) => props.onSaveView(name, model.state)}
            />
          </>
        }
      />
      {finding && <BankFind onGrown={model.reload} />}
      {collection && (
        <CollectionTools
          collection={collection}
          onDeleted={(collections) => {
            onCollections(collections);
            window.location.hash = viewHref('outlier-bank');
          }}
        />
      )}
      {props.onRemoveView && (
        <p className="text-body-sm text-dim">
          A view you saved.{' '}
          <button
            type="button"
            onClick={props.onRemoveView}
            className="rounded font-semibold text-link hover:underline"
          >
            Remove this view
          </button>
        </p>
      )}
      {model.problem && <Notice tone="problem">{model.problem}</Notice>}
      {page && page.total === 0 && !model.loading && (
        <EmptyState
          title="The bank is empty"
          line="Make a map on Today, or press Find more by keyword."
          action={<Button href={viewHref('home')}>Go to Today</Button>}
        />
      )}
      {page && page.total > 0 && videos.length === 0 && !model.loading && (
        <Notice>Nothing in the bank matches these filters.</Notice>
      )}
      <ol className="grid min-w-0 grid-cols-1 gap-x-6 gap-y-8 sm:grid-cols-2 xl:grid-cols-3">
        {videos.map((video) => (
          <li key={video.videoId} className="min-w-0">
            <GridCard
              video={gridBankVideo(video)}
              picked={pickedIds.includes(video.videoId)}
              onPick={() => onPick(video)}
              save={
                <BankSave
                  videoId={video.videoId}
                  collections={model.collections}
                  inCollections={model.savedOf(video.videoId)}
                  onChanged={(collections, ids) => {
                    model.setCollections(collections);
                    model.setSaved(video.videoId, ids);
                    onCollections(collections);
                  }}
                />
              }
            />
          </li>
        ))}
      </ol>
      {left > 0 && <ShowMore left={left} noun="videos" onClick={model.more} />}
    </>
  );
}
