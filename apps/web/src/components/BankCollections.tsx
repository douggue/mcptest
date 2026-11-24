import type { BankCollection } from '@jgtube/core';
import { Download, X } from 'lucide-react';
import { createBankApi, exportHref, toggleBankChoice } from '../lib/bank';
import type { BankModel } from './useBank';

const bankApi = createBankApi();
const LINK =
  'inline-flex min-h-9 items-center gap-1 rounded-full px-2 text-body-sm text-primary hover:bg-surface-container-high';

function CollectionRow({
  model,
  collection,
}: {
  readonly model: BankModel;
  readonly collection: BankCollection;
}) {
  const key = `c${collection.id}`;
  const shown = model.state.chosen.collection.includes(key);
  const remove = () => {
    if (!window.confirm(`Delete the collection “${collection.name}”? The videos stay in the bank.`))
      return;
    bankApi.deleteCollection(collection.id).then(
      (list) => {
        model.setCollections(list);
        if (shown) model.update((state) => toggleBankChoice(state, 'collection', key));
        model.reload();
      },
      () => undefined,
    );
  };
  return (
    <li className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5 rounded-full border border-border-subtle py-0.5 pl-3 pr-1">
      <button
        type="button"
        aria-pressed={shown}
        onClick={() => model.update((state) => toggleBankChoice(state, 'collection', key))}
        className={`min-h-9 min-w-0 break-words text-left text-body-sm ${shown ? 'font-semibold text-primary' : 'text-on-surface'}`}
      >
        {collection.name} <span className="text-outline">{collection.count}</span>
      </button>
      <a
        href={exportHref(collection.id, 'csv')}
        download
        className={LINK}
        aria-label={`Export ${collection.name} as CSV`}
      >
        <Download aria-hidden="true" className="h-3.5 w-3.5" />
        CSV
      </a>
      <a
        href={exportHref(collection.id, 'md')}
        download
        className={LINK}
        aria-label={`Export ${collection.name} as Markdown`}
      >
        MD
      </a>
      <button
        type="button"
        onClick={remove}
        aria-label={`Delete ${collection.name}`}
        className="flex h-9 w-9 items-center justify-center rounded-full text-outline hover:bg-surface-container-high hover:text-on-surface"
      >
        <X aria-hidden="true" className="h-4 w-4" />
      </button>
    </li>
  );
}

/** The owner's collections: press one to show only it, export it, or delete it. */
export function BankCollections({ model }: { readonly model: BankModel }) {
  if (model.collections.length === 0) return null;
  return (
    <section aria-label="Your collections" className="flex min-w-0 flex-col gap-2">
      <h2 className="text-body-md font-semibold text-on-surface">Your collections</h2>
      <ul className="flex min-w-0 flex-wrap gap-2">
        {model.collections.map((collection) => (
          <CollectionRow key={collection.id} model={model} collection={collection} />
        ))}
      </ul>
    </section>
  );
}
