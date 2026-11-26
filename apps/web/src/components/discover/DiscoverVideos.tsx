import type { BankCollection } from '@jgtube/core';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createBankApi } from '../../lib/bank';
import { videosViewHref } from '../../lib/routes';
import {
  OWN_VIEWS_KEY,
  ownKey,
  ownViewsText,
  parseOwnViews,
  viewNameProblem,
  viewPills,
  viewSource,
  type OwnView,
  type ViewSource,
} from '../../lib/videoViews';
import { ViewPage } from '../layout/SplitView';
import { Transfers } from '../Transfers';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/States';
import { ViewPills } from '../ui/Tabs';
import { VideoBreakdownTab } from '../VideoBreakdownTab';
import { NeedsMap, type ViewParts } from '../viewParts';
import { BankGrid } from './BankGrid';
import { MapGrid } from './MapGrid';

/** The views the owner saved, kept in this browser. */
function useOwnViews() {
  const [views, setViews] = useState<readonly OwnView[]>(() => {
    try {
      return parseOwnViews(window.localStorage.getItem(OWN_VIEWS_KEY));
    } catch {
      return [];
    }
  });
  const keep = useCallback((next: readonly OwnView[]) => {
    setViews(next);
    try {
      window.localStorage.setItem(OWN_VIEWS_KEY, ownViewsText(next));
    } catch {
      // A private window or blocked storage: the view works until the page is closed.
    }
  }, []);
  return { views, keep };
}

/**
 * The owner's collections, for the row of views: a small read of their own.
 * How many videos the bank holds is told by the bank's grid once it is open,
 * so no other view reads the bank to show a number.
 */
function useBankFacts(reloadKey: string) {
  const api = useMemo(() => createBankApi(), []);
  const [total, setTotal] = useState<number | null>(null);
  const [collections, setCollections] = useState<readonly BankCollection[] | null>(null);
  useEffect(() => {
    let current = true;
    api.collections().then(
      (found) => current && setCollections(found),
      () => current && setCollections([]),
    );
    return () => {
      current = false;
    };
  }, [api, reloadKey]);
  return { total, setTotal, collections, setCollections };
}

interface BodyProps {
  readonly source: ViewSource;
  readonly parts: ViewParts;
  readonly collections: readonly BankCollection[];
  readonly onCollections: (collections: readonly BankCollection[]) => void;
  /** Told how many videos the bank holds, once its grid has read it. */
  readonly onBankTotal: (total: number) => void;
  readonly own: ReturnType<typeof useOwnViews>;
}

/** The grid of the view on screen, from its source. */
function Body({ source, parts, collections, onCollections, onBankTotal, own }: BodyProps) {
  const { page, work } = parts;
  const { lab } = work;
  const pickedIds = lab.picks.map((pick) => pick.videoId);
  const nameProblem = (name: string): string | null => viewNameProblem(name, own.views);
  const save = (view: OwnView): void => {
    own.keep([...own.views, view]);
    window.location.hash = videosViewHref(ownKey(view));
  };
  const remove = (view: OwnView): void => {
    own.keep(own.views.filter((one) => one !== view));
    window.location.hash = videosViewHref('');
  };
  if (source.kind === 'missing') {
    return (
      <EmptyState
        title="That view is not here any more"
        line="It may have been removed, or its collection deleted."
        action={<Button href={videosViewHref('')}>Open Breaking out</Button>}
      />
    );
  }
  if (source.kind === 'bank') {
    const { own: saved } = source;
    return (
      <BankGrid
        initial={source.filters ?? undefined}
        collection={collections.find((one) => one.id === source.collectionId) ?? null}
        pickedIds={pickedIds}
        onPick={(video) =>
          lab.pick({
            videoId: video.videoId,
            title: video.title,
            channelTitle: video.channel.title,
            modelOpening: false,
            from: 'breakout',
          })
        }
        onCollections={onCollections}
        onTotal={onBankTotal}
        nameProblem={nameProblem}
        onSaveView={(name, filters) => save({ name, source: 'bank', filters })}
        onRemoveView={saved ? () => remove(saved) : undefined}
      />
    );
  }
  if (source.kind !== 'map') return null;
  const visible = page.visible;
  if (!visible) return null;
  const { own: saved } = source;
  return (
    <MapGrid
      items={visible.breakouts}
      initial={source.filters}
      centerTitle={visible.center.title}
      pickedIds={pickedIds}
      onPick={(item) =>
        lab.pick({
          videoId: item.videoId,
          title: item.title,
          channelTitle: item.channelTitle,
          modelOpening: false,
          from: 'breakout',
        })
      }
      nameProblem={nameProblem}
      onSaveView={(name, filters) => save({ name, source: 'map', filters })}
      onRemoveView={saved ? () => remove(saved) : undefined}
    />
  );
}

interface Props {
  /** The view on screen, as the address carries it after `discover/videos`. */
  readonly viewKey: string;
  readonly parts: ViewParts;
}

/**
 * Discover › Videos: one row of saved views over one grid. Breaking out,
 * 100× and up and Small channels are the map's breakouts under the old
 * list's filters; All-time bank and each collection are the bank; Other
 * languages and Studied keep their own lists. A view can be saved under a
 * name of the owner's own.
 */
export function DiscoverVideos({ viewKey, parts }: Props) {
  const { page, work, path } = parts;
  const own = useOwnViews();
  const bank = useBankFacts(work.refresh.run.status);
  const transfers = work.transfers.state;
  const source = viewSource(viewKey, bank.collections, own.views);
  const pills = viewPills({
    breakouts: page.visible?.breakouts ?? null,
    bankTotal: bank.total,
    collections: bank.collections ?? [],
    own: own.views,
    transfers: transfers.status === 'ready' ? transfers.list.ideas.length : null,
    studied: work.videoBreakdown.kept?.length ?? null,
  });
  const row = (
    <ViewPills
      label="Saved views"
      active={viewKey}
      items={pills.map((pill) => ({ ...pill, href: videosViewHref(pill.key) }))}
    />
  );
  if (source.kind === 'transfers' || source.kind === 'studied') {
    const stored =
      transfers.status === 'ready' &&
      transfers.list.ideas.length + transfers.list.formats.length > 0;
    return (
      <>
        <div className="mx-auto w-full max-w-[1260px] min-w-0 px-4 pt-4 sm:px-8">{row}</div>
        {source.kind === 'studied' ? (
          <VideoBreakdownTab parts={parts} />
        ) : // With no map and nothing read there is nothing to compare yet: say what to do first.
        page.snapshot === null && !stored ? (
          <NeedsMap view="transfers" />
        ) : (
          <Transfers
            transfers={work.transfers}
            hasMap={page.snapshot !== null}
            onMakeConcepts={page.snapshot ? path.conceptsFrom : undefined}
          />
        )}
      </>
    );
  }
  return (
    <ViewPage id="discover-videos">
      {row}
      {source.kind === 'map' && !page.snapshot ? (
        <NeedsMap view="breakouts" bare />
      ) : (
        <Body
          // Each view opens with its own filters: a new view is a new grid.
          key={viewKey}
          source={source}
          parts={parts}
          collections={bank.collections ?? []}
          onCollections={bank.setCollections}
          onBankTotal={bank.setTotal}
          own={own}
        />
      )}
    </ViewPage>
  );
}
