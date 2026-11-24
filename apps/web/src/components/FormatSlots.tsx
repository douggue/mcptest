import type { Ingredient, IngredientLayer, SuggestedSlot } from '@jgtube/core';
import { AlertTriangle, Sparkles, X } from 'lucide-react';
import { useState } from 'react';
import {
  choicesFor,
  clearSlot,
  fillSlot,
  noteSlot,
  slotWarnings,
  type FormatView,
  type SlotWarning,
} from '../lib/formatBuilder';
import { INGREDIENT_LAYERS, LAYER_LABELS, evidenceLine } from '../lib/formatShelf';
import { FIELD } from './LabStatus';
import type { FormatBuilder } from './useFormatBuilder';

const SMALL =
  'inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 py-1 text-body-sm font-semibold text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface';
const EMPTY = '';

function Warnings({ warnings }: { readonly warnings: readonly SlotWarning[] }) {
  if (warnings.length === 0) return null;
  return (
    <ul className="flex min-w-0 flex-col gap-1">
      {warnings.map((warning) => (
        <li
          key={`${warning.kind}-${warning.text}`}
          className="flex min-w-0 items-start gap-1.5 text-body-sm text-metric-amber"
        >
          <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 flex-none" />
          <span className="min-w-0 break-words">{warning.text}</span>
        </li>
      ))}
    </ul>
  );
}

/** The AI's pick for this slot, when it differs from what is there, with its reason and a Use. */
function Suggested({
  pick,
  item,
  onUse,
}: {
  readonly pick: SuggestedSlot;
  readonly item: Ingredient;
  readonly onUse: () => void;
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-start gap-2 rounded border border-border-subtle p-2 text-body-sm">
      <Sparkles aria-hidden="true" className="mt-0.5 h-4 w-4 flex-none text-primary" />
      <p className="min-w-0 flex-1 break-words text-on-surface-variant">
        <span className="text-on-surface">AI suggests {item.name}.</span> {pick.reason}
      </p>
      <button type="button" onClick={onUse} className={SMALL}>
        Use
      </button>
    </div>
  );
}

interface RowProps {
  readonly layer: IngredientLayer;
  readonly format: FormatView;
  readonly shelf: readonly Ingredient[];
  readonly warnings: readonly SlotWarning[];
  readonly builder: FormatBuilder;
}

function SlotRow({ layer, format, shelf, warnings, builder }: RowProps) {
  const slot = format.slots[layer];
  const choices = choicesFor(shelf, layer);
  const item = slot ? shelf.find((one) => one.id === slot.ingredientId) : undefined;
  const pick = format.suggestion?.slots.find((one) => one.layer === layer);
  const picked = pick ? shelf.find((one) => one.id === pick.ingredientId) : undefined;
  const [note, setNote] = useState(slot?.note ?? '');
  const fill = (id: number) => void builder.change({ slots: fillSlot(format.slots, layer, id) });
  return (
    <li className="flex min-w-0 flex-col gap-2 border-t border-border-subtle pt-space-sm first:border-t-0 first:pt-0">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <label className="flex min-w-0 flex-[1_1_16rem] flex-col gap-1">
          <span className="text-label text-on-surface">{LAYER_LABELS[layer]}</span>
          <select
            value={slot ? String(slot.ingredientId) : EMPTY}
            disabled={choices.length === 0}
            onChange={(event) =>
              event.target.value === EMPTY
                ? void builder.change({ slots: clearSlot(format.slots, layer) })
                : fill(Number(event.target.value))
            }
            className={FIELD}
          >
            <option value={EMPTY}>
              {choices.length === 0 ? 'Nothing on the shelf for this yet' : 'Empty'}
            </option>
            {choices.map((one) => (
              <option key={one.id} value={one.id}>
                {one.proven ? '✓ ' : ''}
                {one.name}
              </option>
            ))}
          </select>
        </label>
        {slot && (
          <button
            type="button"
            onClick={() => void builder.change({ slots: clearSlot(format.slots, layer) })}
            className={`${SMALL} self-end`}
          >
            <X aria-hidden="true" className="h-4 w-4" />
            Empty it
          </button>
        )}
      </div>
      {item && (
        <p className="text-body-sm text-outline">
          {item.sourceLabel} · {evidenceLine(item.evidence, item.proven)}
        </p>
      )}
      <Warnings warnings={warnings} />
      {pick && picked && pick.ingredientId !== slot?.ingredientId && (
        <Suggested pick={pick} item={picked} onUse={() => fill(picked.id)} />
      )}
      {slot && (
        <input
          value={note}
          maxLength={1000}
          aria-label={`Your note on the ${LAYER_LABELS[layer].toLowerCase()} slot`}
          placeholder="Your note on this slot"
          onChange={(event) => setNote(event.target.value)}
          onBlur={() =>
            note !== slot.note &&
            void builder.change({ slots: noteSlot(format.slots, layer, note) })
          }
          className={FIELD}
        />
      )}
    </li>
  );
}

/** One row per layer: the ingredient in it, the checks beside it, the AI's pick and a note. */
export function FormatSlots(props: {
  readonly format: FormatView;
  readonly shelf: readonly Ingredient[];
  readonly builder: FormatBuilder;
}) {
  const warnings = slotWarnings(props.format);
  return (
    <ul className="flex min-w-0 flex-col gap-space-sm" aria-label="Slots">
      {INGREDIENT_LAYERS.map((layer) => (
        <SlotRow
          key={`${props.format.id}-${layer}-${props.format.slots[layer]?.ingredientId ?? 0}`}
          layer={layer}
          {...props}
          warnings={warnings[layer] ?? []}
        />
      ))}
    </ul>
  );
}
