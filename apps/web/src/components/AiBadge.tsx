import { Sparkles } from 'lucide-react';
import type { AiBadge as Badge, EngineLine } from '../lib/aiBadge';
import { viewHref } from '../lib/routes';

const dot = (ready: boolean): string =>
  `h-2 w-2 flex-none rounded-full ${ready ? 'bg-primary-container shadow-[0_0_6px_#00d2ff]' : 'bg-outline-variant'}`;

function Line({ line }: { readonly line: EngineLine }) {
  return (
    <li className="flex items-center justify-between gap-space-md">
      <span className="flex items-center gap-2 text-on-surface">
        <span aria-hidden="true" className={dot(line.ready)} />
        {line.name}
      </span>
      <span className={line.ready ? 'text-primary' : 'text-outline'}>{line.state}</span>
    </li>
  );
}

/**
 * The top bar's word on which AI answers, on every view: on Automatic the
 * engine that would be tried first, else the one chosen. Hovering or focusing
 * it lists each engine as ready or not set up; pressing it opens Settings,
 * where the choice is made.
 */
export function AiBadge({ badge }: { readonly badge: Badge }) {
  const states = badge.lines.map((line) => `${line.name}: ${line.state}`).join('. ');
  return (
    <div className="group relative min-w-0">
      <a
        href={viewHref('settings')}
        aria-label={`AI: ${badge.name}. ${badge.summary} ${states}${states ? '. ' : ''}Open settings to change it.`}
        className="flex min-h-11 min-w-0 items-center gap-2 rounded-full border border-border-subtle bg-surface-card px-3 text-body-sm transition-colors hover:border-border-highlight focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary-container"
      >
        <Sparkles aria-hidden="true" className="h-4 w-4 flex-none text-metric-amber" />
        <span className="hidden text-label text-outline sm:inline">AI</span>
        <span aria-hidden="true" className={dot(badge.ready)} />
        <span className="hidden max-w-[12rem] truncate font-semibold text-on-surface sm:inline">
          {badge.name}
        </span>
        {badge.automatic && (
          <span className="hidden text-label text-outline lg:inline">Automatic</span>
        )}
      </a>
      <div
        aria-hidden="true"
        className="pointer-events-none invisible absolute right-0 top-full z-50 mt-2 w-72 rounded border border-border-subtle bg-surface-card p-space-md text-body-sm opacity-0 shadow-2xl transition-opacity group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100"
      >
        <p className="text-on-surface-variant">{badge.summary}</p>
        {badge.lines.length > 0 && (
          <ul className="mt-space-sm flex flex-col gap-1.5">
            {badge.lines.map((line) => (
              <Line key={line.id} line={line} />
            ))}
          </ul>
        )}
        <p className="mt-space-sm text-label text-outline">Press to choose in Settings</p>
      </div>
    </div>
  );
}

export { Line as EngineStatusLine };
