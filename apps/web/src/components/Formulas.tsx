import { FORMULA_WINDOWS } from '@jgtube/core/src/formulas/formulas';
import { Shapes, Sparkles } from 'lucide-react';
import { FormulaCard } from './FormulaCard';
import { Card, Field } from './layout/Card';
import { Details } from './layout/Details';
import { PanelAction, PanelTitle } from './layout/PanelAction';
import { Segmented } from './layout/Segmented';
import { SplitView, ViewPage } from './layout/SplitView';
import { ViewHeader } from './layout/ViewHeader';
import { LabStatus } from './LabStatus';
import type { Lab } from './useLab';

const WINDOWS = FORMULA_WINDOWS.map((days) => ({ value: String(days), label: `${days} days` }));

/** What the last run left out, so nothing disappears without a word. */
function Notes({ lab }: { readonly lab: Lab }) {
  const notes = lab.formulaNotes;
  if (notes === null || (notes.dropped.length === 0 && notes.unread === 0)) return null;
  const left = notes.dropped.length + notes.unread;
  return (
    <Details summary={`Left out of the last run (${left} of ${notes.proposed + notes.unread})`}>
      <div className="flex flex-col gap-1 text-body-sm text-on-surface-variant">
        {notes.unread > 0 && <p>{notes.unread} could not be read: a part was missing.</p>}
        {notes.dropped.map((one) => (
          <p key={one.formula} className="break-words">
            {one.formula}: {one.reason}
          </p>
        ))}
      </div>
    </Details>
  );
}

interface PanelProps {
  readonly lab: Lab;
  readonly busy: boolean;
  readonly centerTitle: string;
}

/** The controls: which videos to look at, and the one button that finds the formats. */
function FormulaPanel({ lab, busy, centerTitle }: PanelProps) {
  // Once formats are found, finding them again is a quiet choice: the next step is to remix one.
  const found = (lab.formulas?.formulas.length ?? 0) > 0;
  return (
    <>
      <PanelTitle
        id="formulas-title"
        title="Look for formats"
        lead={<>Title wordings that several breakout videos around {centerTitle} share.</>}
      />
      <Field label="Videos from the last">
        <Segmented
          label="Videos from the last"
          fill
          options={WINDOWS}
          value={String(lab.formulaWindow)}
          onChange={(days) => lab.setFormulaWindow(Number(days))}
          disabled={busy}
        />
      </Field>
      <PanelAction
        icon={Sparkles}
        quiet={found}
        disabled={busy}
        onClick={lab.findFormulas}
        note="An AI run of two to three minutes."
        blocked={busy ? 'Waits for the AI run under way to finish.' : null}
      >
        {found ? 'Find formats again' : 'Find formats'}
      </PanelAction>
      <Notes lab={lab} />
      <Details summary="How this works">
        <p className="text-body-sm text-on-surface-variant">
          An AI groups the titles, with a named slot for what changes. Jgtube keeps a formula only
          when at least two stored videos of this map stand behind it, and works out the numbers
          itself. One video is an example, not a format. &ldquo;Add to ideas&rdquo; takes a format
          into Ideas. The next run for a window replaces its formats.
        </p>
      </Details>
    </>
  );
}

interface Props {
  readonly lab: Lab;
  /** An AI run is under way somewhere on the page. */
  readonly busy: boolean;
  readonly centerTitle: string;
  /** Takes a formula into the idea lab as its title format. */
  readonly onRemix: (formulaId: number) => void;
}

/**
 * Title formulas: wordings that several videos doing unusually well on this
 * map share, with named slots for what changes. An AI proposes them; which
 * videos count and every number shown come from the store.
 */
export function Formulas({ lab, busy, centerTitle, onRemix }: Props) {
  const list = lab.formulas;
  const formulas = list?.formulas ?? [];
  return (
    <ViewPage id="formulas" labelledBy="formulas-title">
      <SplitView
        width="narrow"
        mainFirst
        sideLabel="Finding formats"
        side={<FormulaPanel lab={lab} busy={busy} centerTitle={centerTitle} />}
      >
        <ViewHeader
          title="Formats"
          icon={Shapes}
          count={formulas.length}
          lead={
            list?.runAt
              ? `Found on ${list.runAt.slice(0, 10)}, from videos of the ${list.windowDays} days before.`
              : undefined
          }
        />
        <LabStatus
          state={lab.jobs.state}
          kinds={['formulas']}
          working="Asking the AI to group the titles"
          takes="An AI run of two to three minutes; it uses some of that AI’s plan allowance."
        />
        {list && formulas.length === 0 && (
          <Card>
            <Shapes aria-hidden="true" className="h-6 w-6 text-metric-amber" />
            <p className="text-body-md text-on-surface">
              No formats found for the last {list.windowDays} days yet.
            </p>
            <p className="text-body-sm text-on-surface-variant">Press Find formats.</p>
          </Card>
        )}
        {formulas.length > 0 && list && (
          <ol className="flex flex-col gap-space-lg">
            {formulas.map((formula) => (
              <li key={formula.id}>
                <FormulaCard
                  formula={formula}
                  windowDays={list.windowDays}
                  onRemix={() => onRemix(formula.id)}
                />
              </li>
            ))}
          </ol>
        )}
      </SplitView>
    </ViewPage>
  );
}
