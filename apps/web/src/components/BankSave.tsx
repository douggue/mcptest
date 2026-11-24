import type { BankCollection } from '@jgtube/core';
import { Bookmark } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { MAX_COLLECTION_NAME } from '@jgtube/core/src/bank/collections';
import { createBankApi } from '../lib/bank';
import { Popover } from './layout/Popover';

const bankApi = createBankApi();

interface Props {
  readonly videoId: string;
  readonly collections: readonly BankCollection[];
  /** The ids of the collections the video is in now. */
  readonly inCollections: readonly number[];
  readonly onChanged: (
    collections: readonly BankCollection[],
    inCollections: readonly number[],
  ) => void;
}

/** Saves one video to the owner's collections, or takes it out; a new collection can be named here. */
export function BankSave({ videoId, collections, inCollections, onChanged }: Props) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const run = (work: Promise<readonly BankCollection[]>, next: readonly number[]) => {
    work
      .then((list) => {
        setProblem(null);
        onChanged(list, next);
      })
      .catch((error: unknown) =>
        setProblem(error instanceof Error ? error.message : String(error)),
      );
  };
  const toggle = (id: number) => {
    const isIn = inCollections.includes(id);
    run(
      isIn ? bankApi.removeFromCollection(id, videoId) : bankApi.addToCollection(id, videoId),
      isIn ? inCollections.filter((one) => one !== id) : [...inCollections, id],
    );
  };
  const create = (event: FormEvent) => {
    event.preventDefault();
    const wanted = name.trim();
    if (wanted === '') return;
    bankApi
      .createCollection(wanted)
      .then((list) => {
        const made = list.find((one) => one.name.toLowerCase() === wanted.toLowerCase());
        setName('');
        if (made) run(bankApi.addToCollection(made.id, videoId), [...inCollections, made.id]);
        else onChanged(list, inCollections);
      })
      .catch((error: unknown) =>
        setProblem(error instanceof Error ? error.message : String(error)),
      );
  };
  const saved = inCollections.length > 0;
  return (
    <Popover
      label={
        <span className="flex items-center gap-1">
          <Bookmark aria-hidden="true" className={`h-4 w-4 ${saved ? 'fill-current' : ''}`} />
          {saved ? 'Saved' : 'Save'}
        </span>
      }
      active={saved}
      open={open}
      onOpenChange={setOpen}
    >
      <div className="flex min-w-0 flex-col gap-2">
        <p className="text-body-sm font-semibold text-on-surface">Save to a collection</p>
        {collections.map((one) => (
          <label
            key={one.id}
            className="flex min-h-9 min-w-0 items-center gap-2 text-body-sm text-on-surface-variant"
          >
            <input
              type="checkbox"
              checked={inCollections.includes(one.id)}
              onChange={() => toggle(one.id)}
              className="h-4 w-4 accent-primary"
            />
            <span className="min-w-0 break-words">{one.name}</span>
          </label>
        ))}
        <form onSubmit={create} className="flex min-w-0 gap-2">
          <input
            value={name}
            maxLength={MAX_COLLECTION_NAME}
            onChange={(event) => setName(event.target.value)}
            placeholder="New collection, e.g. Hooks to steal"
            aria-label="New collection name"
            className="min-h-10 min-w-0 flex-1 rounded-full border border-border-subtle bg-space-deep px-3 text-body-sm text-on-surface placeholder:text-outline"
          />
          <button
            type="submit"
            disabled={name.trim() === ''}
            className="min-h-10 rounded-full px-3 text-body-sm font-semibold text-primary hover:bg-surface-container-high disabled:opacity-50"
          >
            Add
          </button>
        </form>
        {problem && (
          <p role="alert" className="text-body-sm text-error">
            {problem}
          </p>
        )}
      </div>
    </Popover>
  );
}
