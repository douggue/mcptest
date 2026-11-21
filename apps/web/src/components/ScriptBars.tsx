import { ChevronDown, Download } from 'lucide-react';
import type { ComponentProps } from 'react';
import { clockOf, scriptStats, type ScriptStage, type ScriptView } from '../lib/scriptWriter';
import { StatusBar } from './layout/StatusBar';
import { Exports } from './ScriptExports';
import { StatusSelect } from './ScriptSetup';
import { StepTabs } from './ScriptSteps';
import type { Script } from './useScript';

interface TopProps {
  readonly script: Script;
  readonly view: ScriptView;
  readonly tabs: ComponentProps<typeof StepTabs>;
  readonly exports: ComponentProps<typeof Exports>;
}

const savedWords = (saving: Script['saving']): string =>
  saving === 'saving' ? 'Saving…' : saving === 'failed' ? 'Not saved' : 'Saved';

/** The export choices in a menu that opens under its button. */
function ExportMenu(props: ComponentProps<typeof Exports>) {
  return (
    <details className="group/export relative max-sm:open:basis-full">
      <summary className="flex min-h-9 cursor-pointer list-none items-center gap-1.5 rounded-lg bg-on-surface px-3 text-body-sm font-semibold text-space-deep hover:bg-white focus:outline-none focus-visible:ring-1 focus-visible:ring-primary-container [&::-webkit-details-marker]:hidden">
        <Download aria-hidden="true" className="h-4 w-4" />
        Export
        <ChevronDown
          aria-hidden="true"
          className="h-4 w-4 transition-transform group-open/export:rotate-180"
        />
      </summary>
      <div className="absolute right-0 top-full z-40 mt-2 w-[min(28rem,calc(100vw-2rem))] max-sm:static max-sm:w-full rounded-lg border border-border-subtle bg-surface-card p-space-md shadow-2xl">
        <Exports {...props} />
      </div>
    </details>
  );
}

/** The bar above the script: the steps at the left; the status, whether it is saved and the export at the right. */
export function ScriptTopBar({ script, view, tabs, exports }: TopProps) {
  return (
    <div className="flex min-w-0 flex-wrap items-center justify-between gap-space-sm border-b border-border-subtle pb-space-md">
      <StepTabs {...tabs} />
      <div className="flex flex-wrap items-center gap-2">
        <StatusSelect script={script} view={view} />
        <span role="status" className="px-1 text-body-sm text-outline">
          {savedWords(script.saving)}
        </span>
        <ExportMenu {...exports} />
      </div>
    </div>
  );
}

interface FooterProps {
  readonly view: ScriptView;
  readonly text: string;
  readonly stage: ScriptStage;
}

/** The slim bar at the foot of the script: words, spoken time, reading grade and facts to check. */
export function ScriptFooter({ view, text, stage }: FooterProps) {
  if (stage === 'hooks') return null;
  const rate = view.script?.wordsPerMinute ?? null;
  const markFacts = view.markFacts ?? true;
  const stats = scriptStats(text, rate, markFacts);
  const target = view.script?.targetGrade ?? null;
  const grade =
    stats.grade === null
      ? 'Reading grade: not known'
      : `Reading grade ${stats.grade.toFixed(1)}${target === null ? '' : ` (voice ${target.toFixed(1)})`}`;
  const items = [
    `${stats.words} words of about ${view.plan.targetWords ?? '—'}`,
    rate === null ? 'Spoken time: set a rate' : `~${clockOf(stats.seconds)} at ${rate} a minute`,
    grade,
    ...(markFacts
      ? [
          <span key="facts" className={stats.markers.length > 0 ? 'text-metric-amber' : ''}>
            {stats.markers.length} {stats.markers.length === 1 ? 'fact' : 'facts'} to check
          </span>,
        ]
      : []),
  ];
  return <StatusBar label="What is counted about the script" items={items} />;
}
