import { sentencesOnFacts } from '@jgtube/core/src/research/factSheet';
import { usedFacts, type FactSheetView } from '../lib/research';
import { PRIMARY_BUTTON, QUIET_BUTTON } from './LabStatus';
import { SourceLink } from './SourceLink';
import type { Research } from './useResearch';

const LABEL = 'text-label text-outline';

/** One fact of the sheet with its number and its sources. */
function FactLine({ fact }: { readonly fact: FactSheetView['facts'][number] }) {
  return (
    <li id={`fact-${fact.number}`} className="flex min-w-0 flex-col gap-0.5">
      <span className="text-body-sm text-on-surface">
        <span className="font-semibold text-primary">F{fact.number}</span> {fact.text}
      </span>
      <span className="flex flex-wrap gap-x-2 text-body-sm">
        {fact.sources.map((source) => (
          <SourceLink key={source} href={source} />
        ))}
      </span>
    </li>
  );
}

interface Props {
  readonly research: Research;
  /** The text in the editor, to count what rests on the sheet. */
  readonly text: string;
  readonly busy: boolean;
}

/**
 * The concept's fact sheet beside the editor: the button that researches the
 * subject on the web, how much of the script rests on a sourced fact, the
 * facts the script names as links to their sources, and the whole sheet.
 */
export function ScriptResearch({ research, text, busy }: Props) {
  const sheet = research.view?.sheet ?? null;
  const counts = sentencesOnFacts(text);
  const used = usedFacts(text, sheet);
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded bg-space-deep p-space-sm">
      <span className={LABEL}>Fact sheet</span>
      <button
        type="button"
        disabled={busy}
        onClick={research.research}
        className={`self-start ${sheet ? QUIET_BUTTON : PRIMARY_BUTTON}`}
      >
        {sheet ? 'Research again' : 'Research this subject'}
      </button>
      <span className="text-body-sm text-outline">
        A web search run of a few minutes, using Claude Code&rsquo;s web tools and some of its plan
        allowance. Sources can be wrong: open them.
      </span>
      <span className="text-body-sm text-on-surface">
        {counts.sourced} {counts.sourced === 1 ? 'sentence rests' : 'sentences rest'} on a sourced
        fact · {counts.unchecked} still unchecked
      </span>
      {used.length > 0 && (
        <div className="flex min-w-0 flex-col gap-1">
          <span className={LABEL}>Sources in this script</span>
          <ul className="flex flex-col gap-1.5">
            {used.map((fact) => (
              <FactLine key={fact.number} fact={fact} />
            ))}
          </ul>
        </div>
      )}
      {sheet && (
        <details className="min-w-0">
          <summary className="cursor-pointer text-body-sm text-primary">
            The whole sheet: {sheet.facts.length} facts, researched {sheet.writtenAt.slice(0, 10)}
          </summary>
          <ul className="mt-2 flex flex-col gap-1.5">
            {sheet.facts.map((fact) => (
              <FactLine key={fact.number} fact={fact} />
            ))}
          </ul>
          {sheet.notFound.length > 0 && (
            <p className="mt-2 text-body-sm text-on-surface-variant">
              Not found: {sheet.notFound.join(' · ')}
            </p>
          )}
          {sheet.disputed.length > 0 && (
            <p className="mt-1 text-body-sm text-metric-amber">
              Disputed: {sheet.disputed.join(' · ')}
            </p>
          )}
        </details>
      )}
    </div>
  );
}
