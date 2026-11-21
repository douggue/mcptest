import { aiBadge } from '../lib/aiBadge';
import type { EngineChoice, EngineReport } from '../lib/analyses';
import { viewHref } from '../lib/routes';

interface Props {
  readonly choice: EngineChoice;
  readonly engines: EngineReport | null;
}

/**
 * Which AI answers, in one read-only line with the way to change it. The
 * choice is made in Settings and shown in the top bar; a panel only says it.
 */
export function AiLine({ choice, engines }: Props) {
  const badge = aiBadge(choice, engines);
  return (
    <p className="text-body-sm text-on-surface-variant">
      AI: <span className="font-semibold text-on-surface">{badge.name}</span>
      {badge.automatic ? ' (Automatic)' : ''}
      {!badge.ready && <span className="text-metric-amber"> · not ready</span>} ·{' '}
      <a href={viewHref('settings')} className="font-semibold text-primary hover:underline">
        Change
      </a>
    </p>
  );
}
