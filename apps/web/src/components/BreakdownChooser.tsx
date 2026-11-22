import { Search } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import {
  NO_FILTERS,
  filterCandidates,
  suggestedPicks,
  type Candidate,
  type PickFilters,
} from '../lib/breakdownPicks';
import { breakdownHref } from '../lib/routes';
import { CandidateRow, NO_BADGE, type CandidateBadge } from './CandidateRow';
import { Notice, ShowMore } from './layout/Notice';
import { FIELD, QUIET_BUTTON } from './LabStatus';
import type { PasteState } from './useCandidates';

const PAGE = 12;
const CHANNEL_REF = /^(@[\w.-]{3,30}|UC[\w-]{22}|(https?:\/\/)?(www\.|m\.)?youtube\.com\/.+)$/i;

/** Why a pasted channel cannot be read, in one line; null when it can be tried. */
export function pasteProblem(text: string): string | null {
  const typed = text.trim();
  if (typed === '') return 'Paste a channel link, an @handle or a channel id first.';
  return CHANNEL_REF.test(typed)
    ? null
    : 'That is not a channel. Paste a link like youtube.com/@name, an @handle, or an id starting UC.';
}

/** Paste a channel to break down; read once when it is not stored. */
export function PasteChannel({
  paste,
  onRead,
}: {
  readonly paste: PasteState;
  readonly onRead: (channel: string) => void;
}) {
  const [text, setText] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    const found = pasteProblem(text);
    setProblem(found);
    if (found === null) onRead(text.trim());
  };
  return (
    <form
      onSubmit={submit}
      className="flex min-w-0 flex-col gap-2"
      aria-label="Paste a channel link"
    >
      <label htmlFor="breakdown-paste" className="text-label text-on-surface-variant">
        Paste a channel link
      </label>
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
        <input
          id="breakdown-paste"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="youtube.com/@channel, @handle or UC…"
          className={FIELD}
        />
        <button
          type="submit"
          disabled={paste.status === 'reading'}
          className={`min-h-11 flex-none ${QUIET_BUTTON}`}
        >
          {paste.status === 'reading' ? 'Reading…' : 'Read channel'}
        </button>
      </div>
      {problem && (
        <p role="alert" className="text-body-sm text-error">
          {problem}
        </p>
      )}
      {paste.status === 'reading' && (
        <Notice tone="working">Reading its page and recent videos.</Notice>
      )}
      {paste.status === 'failed' && <Notice tone="problem">{paste.message}</Notice>}
      {paste.status === 'read' && (
        <p className="text-body-sm text-on-surface-variant">
          Read {paste.candidate.title}: {paste.candidate.storedVideos} videos stored.{' '}
          <a
            href={breakdownHref(paste.candidate.id)}
            className="font-semibold text-primary underline"
          >
            Break it down
          </a>
        </p>
      )}
    </form>
  );
}

const FILTERS: ReadonlyArray<readonly [keyof Omit<PickFilters, 'query'>, string]> = [
  ['closeOnly', 'Close only'],
  ['hasBreakouts', 'Has breakouts'],
  ['notBrokenDown', 'Not broken down yet'],
];

/** Every channel on offer, with a search and three filters. */
export function AllCandidates({
  candidates,
  badge = NO_BADGE,
}: {
  readonly candidates: readonly Candidate[];
  readonly badge?: CandidateBadge;
}) {
  const [filters, setFilters] = useState<PickFilters>(NO_FILTERS);
  const [shown, setShown] = useState(PAGE);
  const found = filterCandidates(candidates, filters);
  return (
    <section aria-labelledby="breakdown-all" className="flex min-w-0 flex-col gap-space-md">
      <h3 id="breakdown-all" className="text-headline-md font-bold text-on-surface">
        All channels <span className="text-body-md font-normal text-outline">({found.length})</span>
      </h3>
      <div className="relative min-w-0">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-3 h-5 w-5 text-outline"
        />
        <input
          type="search"
          aria-label="Search channels"
          placeholder="Search by name or @handle"
          value={filters.query}
          onChange={(event) => setFilters({ ...filters, query: event.target.value })}
          className={`${FIELD} pl-10`}
        />
      </div>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Filters">
        {FILTERS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            aria-pressed={filters[key]}
            onClick={() => setFilters({ ...filters, [key]: !filters[key] })}
            className={`min-h-11 rounded-full border px-4 text-body-sm font-semibold transition-colors ${
              filters[key]
                ? 'border-primary-container bg-primary-container text-space-deep'
                : 'border-border-subtle text-on-surface-variant hover:bg-surface-card'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {found.length === 0 ? (
        <Notice>No channel matches. Clear the search or a filter.</Notice>
      ) : (
        <ul className="grid min-w-0 grid-cols-1 gap-space-md lg:grid-cols-2">
          {found.slice(0, shown).map((candidate) => (
            <CandidateRow key={candidate.id} candidate={candidate} badge={badge} />
          ))}
        </ul>
      )}
      {found.length > shown && (
        <ShowMore
          left={found.length - shown}
          noun="channels"
          onClick={() => setShown(shown + PAGE)}
        />
      )}
    </section>
  );
}

/** The few channels suggested first, each with its reason. */
export function SuggestedCandidates({
  candidates,
  now,
  badge = NO_BADGE,
}: {
  readonly candidates: readonly Candidate[];
  readonly now: Date;
  readonly badge?: CandidateBadge;
}) {
  const picks = suggestedPicks(candidates, now);
  return (
    <section aria-labelledby="breakdown-suggested" className="flex min-w-0 flex-col gap-space-md">
      <h3 id="breakdown-suggested" className="text-headline-md font-bold text-on-surface">
        Suggested to break down
      </h3>
      {picks.length === 0 ? (
        <Notice>
          Nothing to suggest: no look-alike with enough stored videos has something breaking out and
          no breakdown yet. Pick any channel below.
        </Notice>
      ) : (
        <ul className="grid min-w-0 grid-cols-1 gap-space-md lg:grid-cols-3">
          {picks.map(({ candidate, reason }) => (
            <CandidateRow key={candidate.id} candidate={candidate} badge={badge} reason={reason} />
          ))}
        </ul>
      )}
    </section>
  );
}
