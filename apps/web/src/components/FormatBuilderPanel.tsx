import type { Ingredient } from '@jgtube/core';
import { filledCount, originalityLine } from '../lib/formatBuilder';
import { INGREDIENT_LAYERS } from '../lib/formatShelf';
import type { AiChoice } from './AiEngines';
import { FormatPicker, NewFormat } from './FormatPicker';
import { FormatSlots } from './FormatSlots';
import { Card } from './layout/Card';
import { Notice } from './layout/Notice';
import { MixPanel } from './MixPanel';
import { BiblePanel } from './BiblePanel';
import type { FormatBuilder } from './useFormatBuilder';

interface Props {
  readonly builder: FormatBuilder;
  readonly shelf: readonly Ingredient[];
  readonly channelId: string | null;
  readonly ai?: AiChoice;
}

/** The format being built: which one, its slots with their checks, and "Suggest a mix". */
export function FormatBuilderPanel({ builder, shelf, channelId, ai }: Props) {
  const { state, chosen } = builder;
  if (state.status === 'loading') return <Notice tone="working">Reading your formats…</Notice>;
  if (state.status === 'failed') return <Notice tone="problem">{state.message}</Notice>;
  const originality = chosen === null ? null : originalityLine(chosen);
  return (
    <section aria-labelledby="format-built-title" className="flex min-w-0 flex-col gap-space-md">
      <h2 id="format-built-title" className="text-headline-md text-on-surface">
        Your format
      </h2>
      {chosen === null ? (
        <Notice>Make your first format: name it, then fill its slots from the shelf.</Notice>
      ) : (
        <Card>
          <FormatPicker builder={builder} />
          <p className="text-body-sm text-outline">
            {filledCount(chosen.slots)} of {INGREDIENT_LAYERS.length} slots filled
          </p>
          {originality && (
            <p
              className={`break-words text-body-sm ${chosen.checks.originality.copiesOneChannel ? 'text-metric-amber' : 'text-on-surface-variant'}`}
            >
              {originality}
            </p>
          )}
          <MixPanel
            format={chosen}
            builder={builder}
            shelfSize={shelf.length}
            channelId={channelId}
            ai={ai}
          />
          <FormatSlots key={chosen.id} format={chosen} shelf={shelf} builder={builder} />
        </Card>
      )}
      {chosen !== null && (
        <Card>
          <BiblePanel format={chosen} builder={builder} channelId={channelId} ai={ai} />
        </Card>
      )}
      {builder.problem && <Notice tone="problem">{builder.problem}</Notice>}
      <NewFormat builder={builder} />
    </section>
  );
}
