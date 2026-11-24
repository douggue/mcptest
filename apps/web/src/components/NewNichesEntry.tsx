import { Sparkles } from 'lucide-react';
import { viewHref } from '../lib/routes';
import { newNichesLine } from '../lib/sweep';

/** "N new niche channels found" by the watchlist sweeps, linked to New niches; nothing for none. */
export function NewNichesEntry({ count }: { readonly count: number }) {
  const line = newNichesLine(count);
  if (line === null) return null;
  return (
    <a
      href={viewHref('niches')}
      className="flex min-h-11 min-w-0 items-center gap-2 rounded bg-surface-container-high px-3 text-body-md text-on-surface transition-colors hover:bg-surface-container-highest"
    >
      <Sparkles aria-hidden="true" className="h-4 w-4 flex-none text-primary" />
      <span className="min-w-0 flex-1 truncate">{line}</span>
      <span className="flex-none text-body-sm font-semibold text-primary">Open New niches</span>
    </a>
  );
}
