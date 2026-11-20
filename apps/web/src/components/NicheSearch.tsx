import { Search } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { describeSearch } from '../lib/niches';
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
      <p className={`rounded bg-surface-card p-space-md ${NOTE}`}>
        To look for niches by keyword, Jgtube needs a YouTube API key. Put{' '}
        <code className="text-on-surface">YOUTUBE_API_KEY=your key</code> in a file named{' '}
        <code className="text-on-surface">.env</code> in the Jgtube folder and start it again.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded bg-surface-card p-space-md">
      <form onSubmit={submit} className="relative">
        <label htmlFor="niche-keyword" className="sr-only">
          Keyword to search YouTube for
        </label>
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-outline"
        />
        <input
          id="niche-keyword"
          type="text"
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          placeholder="Look for niches by keyword: a few words that titles in a niche share"
          autoComplete="off"
          spellCheck={false}
          maxLength={MAX_KEYWORD_LENGTH}
          className="w-full rounded-full bg-space-deep py-2.5 pl-11 pr-36 text-body-sm text-on-surface placeholder-outline shadow-[inset_0_2px_6px_rgba(0,0,0,0.6)] focus:outline-none focus-visible:ring-1 focus-visible:ring-primary-container"
        />
        <button
          type="submit"
          disabled={running || keyword.trim() === ''}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-full bg-on-surface px-4 py-1.5 text-body-sm font-semibold text-space-deep transition-all hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
        >
          {running ? 'Searching…' : 'Search YouTube'}
        </button>
      </form>
      <Outcome search={search} />
    </div>
  );
}
