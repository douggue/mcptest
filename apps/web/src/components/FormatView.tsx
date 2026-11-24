import { useState } from 'react';
import { ALL, shelfItems, type ShelfFilter } from '../lib/formatShelf';
import { viewHref } from '../lib/routes';
import { AddYourOwn } from './AddYourOwn';
import { IngredientCard } from './IngredientCard';
import { Notice } from './layout/Notice';
import { SplitView, ViewPage } from './layout/SplitView';
import { ViewHeader } from './layout/ViewHeader';
import { ShelfFilters } from './ShelfFilters';
import { useShelf, type Shelf } from './useShelf';

function Empty() {
  return (
    <Notice>
      Nothing on your shelf yet. Press “Add to format” on a formula, a hook, a breakout or a
      teardown in{' '}
      <a href={viewHref('breakouts')} className="text-primary underline">
        Research
      </a>
      , or add your own here.
    </Notice>
  );
}

function ShelfList({ shelf, filter }: { readonly shelf: Shelf; readonly filter: ShelfFilter }) {
  const { state } = shelf;
  if (state.status === 'loading') return <Notice tone="working">Reading your shelf…</Notice>;
  if (state.status === 'failed') return <Notice tone="problem">{state.message}</Notice>;
  if (state.items.length === 0) return <Empty />;
  const shown = shelfItems(state.items, filter);
  if (shown.length === 0) return <Notice>Nothing on the shelf matches. Clear a filter.</Notice>;
  return (
    <ul className="grid min-w-0 grid-cols-1 gap-space-md md:grid-cols-2 2xl:grid-cols-3">
      {shown.map((item) => (
        <IngredientCard
          key={item.id}
          item={item}
          onRemove={() => shelf.remove(item.id)}
          onNote={(note) => shelf.setNote(item.id, note)}
        />
      ))}
    </ul>
  );
}

/**
 * The format builder's shelf: every piece the owner took from the research
 * views (or added themselves), each with what code counted it rests on.
 */
export function FormatView() {
  const shelf = useShelf();
  const [filter, setFilter] = useState<ShelfFilter>(ALL);
  const items = shelf.state.status === 'ready' ? shelf.state.items : [];
  return (
    <ViewPage labelledBy="format-builder-title" id="format-builder">
      <ViewHeader
        title="Format"
        titleId="format-builder-title"
        lead="Collect what works, then mix your own style from it."
        count={items.length > 0 ? `${items.length} on the shelf` : undefined}
      />
      <SplitView
        sideLabel="Shelf filters and your own"
        width="narrow"
        side={
          <>
            <ShelfFilters items={items} filter={filter} onChange={setFilter} />
            <AddYourOwn onAdd={shelf.add} />
          </>
        }
      >
        <ShelfList shelf={shelf} filter={filter} />
      </SplitView>
    </ViewPage>
  );
}
