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
import type { AiChoice } from './AiEngines';
import { FormatBuilderPanel } from './FormatBuilderPanel';
import { Details } from './layout/Details';
import { useFormatBuilder, type FormatBuilder } from './useFormatBuilder';
import { fillSlot } from '../lib/formatBuilder';

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

interface ListProps {
  readonly shelf: Shelf;
  readonly filter: ShelfFilter;
  readonly builder: FormatBuilder;
}

function ShelfList({ shelf, filter, builder }: ListProps) {
  const format = builder.chosen;
  const { state } = shelf;
  if (state.status === 'loading') return <Notice tone="working">Reading your shelf…</Notice>;
  if (state.status === 'failed') return <Notice tone="problem">{state.message}</Notice>;
  if (state.items.length === 0) return <Empty />;
  const shown = shelfItems(state.items, filter);
  if (shown.length === 0) return <Notice>Nothing on the shelf matches. Clear a filter.</Notice>;
  return (
    <ul className="grid min-w-0 grid-cols-1 gap-space-md md:grid-cols-2 lg:grid-cols-1">
      {shown.map((item) => (
        <IngredientCard
          key={item.id}
          item={item}
          onRemove={() => shelf.remove(item.id)}
          onNote={(note) => shelf.setNote(item.id, note)}
          use={
            format === null || format.slots[item.layer]?.ingredientId === item.id
              ? undefined
              : {
                  label: `Use in ${format.name}`,
                  run: () =>
                    void builder.change({ slots: fillSlot(format.slots, item.layer, item.id) }),
                }
          }
        />
      ))}
    </ul>
  );
}

interface Props {
  /** The map open now, whose winners "Suggest a mix" reads; null when none is. */
  readonly channelId: string | null;
  readonly ai?: AiChoice;
}

/**
 * The format builder: the shelf of pieces the owner took from the research
 * views (or added), each with what code counted it rests on, beside the
 * format being built from them.
 */
export function FormatView({ channelId, ai }: Props) {
  const shelf = useShelf();
  const [filter, setFilter] = useState<ShelfFilter>(ALL);
  const items = shelf.state.status === 'ready' ? shelf.state.items : [];
  const builder = useFormatBuilder(items.map((item) => item.id).join(','));
  return (
    <ViewPage labelledBy="format-builder-title" id="format-builder">
      <ViewHeader
        title="Format"
        titleId="format-builder-title"
        lead="Collect what works, then mix your own style from it."
        count={items.length > 0 ? `${items.length} on the shelf` : undefined}
      />
      <SplitView
        sideLabel="Your shelf"
        width="wide"
        mainFirst
        side={
          <>
            <h2 className="text-headline-md text-on-surface">Shelf</h2>
            <ShelfFilters items={items} filter={filter} onChange={setFilter} />
            <ShelfList shelf={shelf} filter={filter} builder={builder} />
            <Details summary="Add your own">
              <AddYourOwn onAdd={shelf.add} />
            </Details>
          </>
        }
      >
        <FormatBuilderPanel builder={builder} shelf={items} channelId={channelId} ai={ai} />
      </SplitView>
    </ViewPage>
  );
}
