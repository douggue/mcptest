import type { KeywordSuggestion, KeywordView } from '@jgtube/core';
import { SWEEP_MAX_KEYWORD_LENGTH } from '@jgtube/core/src/sweep/budget';
import { Pause, Play, X } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { sweptText } from '../lib/sweep';
import { FIELD, QUIET_BUTTON } from './LabStatus';

const ICON_BUTTON =
  'flex h-11 w-11 flex-none items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface';
const CHIP =
  'min-h-10 max-w-full truncate rounded-full bg-surface-container-high px-3 text-body-sm text-on-surface transition-colors hover:bg-surface-container-highest';

type Change = (action: 'remove' | 'pause' | 'resume', id: number) => void;

/** One keyword: when it was last swept, what it found, pause and remove. */
function Entry({ entry, onChange }: { readonly entry: KeywordView; readonly onChange: Change }) {
  const Toggle = entry.paused ? Play : Pause;
  const found = `${entry.found} ${entry.found === 1 ? 'niche' : 'niches'} found`;
  return (
    <li className="flex min-w-0 items-center gap-1 border-b border-border-subtle py-1 last:border-b-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <span
          className={`truncate text-body-md ${entry.paused ? 'text-outline' : 'text-on-surface'}`}
        >
          {entry.keyword}
        </span>
        <span className="truncate text-body-sm text-outline">
          {entry.paused ? 'Paused · ' : ''}
          {sweptText(entry.lastSweptAt, new Date())} · {found}
        </span>
      </div>
      <button
        type="button"
        className={ICON_BUTTON}
        aria-label={entry.paused ? `Resume ${entry.keyword}` : `Pause ${entry.keyword}`}
        title={entry.paused ? 'Resume' : 'Pause'}
        onClick={() => onChange(entry.paused ? 'resume' : 'pause', entry.id)}
      >
        <Toggle aria-hidden="true" className="h-4 w-4" />
      </button>
      <button
        type="button"
        className={ICON_BUTTON}
        aria-label={`Remove ${entry.keyword}`}
        title="Remove"
        onClick={() => onChange('remove', entry.id)}
      >
        <X aria-hidden="true" className="h-4 w-4" />
      </button>
    </li>
  );
}

/** Keywords offered from the owner's maps; a press adds one. */
function Suggestions({
  suggestions,
  onAdd,
}: {
  readonly suggestions: readonly KeywordSuggestion[];
  readonly onAdd: (keyword: string) => void;
}) {
  if (suggestions.length === 0) return null;
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="text-body-sm text-outline">From your maps</span>
      <ul className="flex min-w-0 flex-wrap gap-1.5">
        {suggestions.map((one) => (
          <li key={`${one.from}:${one.keyword}`} className="min-w-0 max-w-full">
            <button
              type="button"
              className={CHIP}
              title={
                one.from === 'topic'
                  ? `The topic of ${one.channels} channels on your maps`
                  : `In winning titles of ${one.channels} channels on your maps`
              }
              onClick={() => onAdd(one.keyword)}
            >
              + {one.keyword}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

interface Props {
  readonly keywords: readonly KeywordView[];
  readonly suggestions: readonly KeywordSuggestion[];
  /** False at the most keywords the watchlist holds. */
  readonly canAdd: boolean;
  readonly onAdd: (keyword: string) => void;
  readonly onChange: Change;
}

/** The owner's keywords and topics, with the box that adds one. */
export function WatchlistEntries({ keywords, suggestions, canAdd, onAdd, onChange }: Props) {
  const [typed, setTyped] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const keyword = typed.trim();
    if (keyword === '') return;
    onAdd(keyword);
    setTyped('');
  };
  return (
    <div className="flex min-w-0 flex-col gap-space-sm">
      {keywords.length === 0 ? (
        <p className="text-body-sm text-on-surface-variant">
          No keywords yet. Add a subject a new niche could be about.
        </p>
      ) : (
        <ul className="flex min-w-0 flex-col">
          {keywords.map((entry) => (
            <Entry key={entry.id} entry={entry} onChange={onChange} />
          ))}
        </ul>
      )}
      {canAdd ? (
        <form onSubmit={submit} className="flex min-w-0 gap-2">
          <input
            value={typed}
            maxLength={SWEEP_MAX_KEYWORD_LENGTH}
            onChange={(event) => setTyped(event.target.value)}
            placeholder="A keyword or topic"
            aria-label="Add a keyword or topic"
            autoComplete="off"
            className={FIELD}
          />
          <button
            type="submit"
            disabled={typed.trim() === ''}
            className={`min-h-11 flex-none ${QUIET_BUTTON}`}
          >
            Add
          </button>
        </form>
      ) : (
        <p className="text-body-sm text-outline">
          The watchlist is full. Remove one to add another.
        </p>
      )}
      {canAdd && <Suggestions suggestions={suggestions} onAdd={onAdd} />}
    </div>
  );
}
