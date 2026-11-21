import { viewHref } from '../lib/routes';
import { Search } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { describeSearch } from '../lib/niches';
import { Field } from './layout/Card';
import { FIELD, QUIET_BUTTON } from './LabStatus';
import type { SearchState } from './useNiches';

const MAX_KEYWORD_LENGTH = 200;
const NOTE = 'text-body-sm text-on-surface-variant';

interface Props {
  /** False when no YouTube API key is set, which keyword search needs. */
  readonly canDiscover: boolean;
  readonly search: SearchState;
  readonly onSearch: (keyword: string) => void;
}

/** What the last search did, or is doing. */
function Outcome({ search }: { readonly search: SearchState }) {
  if (search.status === 'running') {
    return (
      <p role="status" className={`flex items-center gap-2 ${NOTE}`}>
        <span className="h-2 w-2 animate-pulse rounded-full bg-primary-container shadow-[0_0_8px_#00d2ff]" />
        Searching YouTube for &ldquo;{search.keyword}&rdquo; and reading the channels found. This
        takes about a minute.
      </p>
    );
  }
  if (search.status === 'done') {
    return (
      <p role="status" className={NOTE}>
        {describeSearch(search.summary)}
      </p>
    );
  }
  if (search.status === 'failed') {
    return (
      <p role="alert" className="text-body-sm text-error">
        {search.message}
      </p>
    );
  }
  return null;
}

/**
 * Finds channels by subject: searches YouTube for recent videos on a keyword
 * and reads the channels behind them, so niches nobody has mapped can show up.
 */
export function NicheSearch({ canDiscover, search, onSearch }: Props) {
  const [keyword, setKeyword] = useState('');
  const running = search.status === 'running';
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const wanted = keyword.trim();
    if (wanted && !running) onSearch(wanted);
  };

  if (!canDiscover) {
    return (
      <div className="flex flex-col gap-2">
        <p className={NOTE}>Add a YouTube key in Settings to look for niches by keyword.</p>
        <a
          href={viewHref('settings')}
          className="flex min-h-11 w-fit items-center rounded-full bg-surface-container-high px-4 text-body-sm font-semibold text-on-surface hover:bg-surface-container-highest"
        >
          Open Settings
        </a>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex min-w-0 flex-col gap-space-sm">
      <Field label={<label htmlFor="niche-keyword">Look for niches by keyword</label>}>
        <div className="relative">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-outline"
          />
          <input
            id="niche-keyword"
            type="text"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="A few words titles in a niche share"
            autoComplete="off"
            spellCheck={false}
            maxLength={MAX_KEYWORD_LENGTH}
            className={`${FIELD} min-h-11 pl-11`}
          />
        </div>
      </Field>
      <button
        type="submit"
        disabled={running || keyword.trim() === ''}
        className={`min-h-10 ${QUIET_BUTTON}`}
      >
        {running ? 'Searching…' : 'Search YouTube'}
      </button>
      <Outcome search={search} />
    </form>
  );
}
