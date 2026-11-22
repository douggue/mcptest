import { ShieldAlert } from 'lucide-react';
import { aiLine, NOT_A_VERDICT, stageLine } from '../lib/risk';
import { Card, Field } from './layout/Card';
import { Details } from './layout/Details';
import { PanelAction, PanelTitle } from './layout/PanelAction';
import { SplitView, ViewPage } from './layout/SplitView';
import { ViewHeader } from './layout/ViewHeader';
import { FIELD } from './LabStatus';
import { RiskLists, RiskNumbers } from './RiskParts';
import { useRisk, type Risk } from './useRisk';

const BOX = FIELD.replace('rounded-full', 'rounded-lg');

interface Props {
  readonly channelId: string | null;
  /** The concept the script writer has open, which the check follows. */
  readonly openConceptId: number | null;
  readonly reloadKey: unknown;
}

/** Which script to check: the kept concepts that have one. */
function ScriptChoice({ risk }: { readonly risk: Risk }) {
  const concepts = risk.view?.concepts ?? [];
  if (concepts.length === 0) {
    return (
      <p className="text-body-sm text-on-surface-variant">
        No kept concept has a script yet. Write one in the script writer first.
      </p>
    );
  }
  return (
    <Field label="Script">
      <select
        aria-label="Script"
        value={risk.conceptId ?? ''}
        onChange={(event) => risk.choose(Number(event.target.value))}
        className={BOX}
      >
        {concepts.map((entry) => (
          <option key={entry.conceptId} value={entry.conceptId}>
            {entry.title}
          </option>
        ))}
      </select>
    </Field>
  );
}

/** What is being done, or why it did not work. */
function WorkLine({ risk }: { readonly risk: Risk }) {
  const { work } = risk;
  return (
    <>
      {risk.problem && (
        <p role="alert" className="text-body-sm text-error">
          {risk.problem}
        </p>
      )}
      {work.status !== 'idle' && (
        <p
          role={work.status === 'failed' ? 'alert' : 'status'}
          className={`text-body-sm ${work.status === 'failed' ? 'text-error' : 'text-on-surface-variant'}`}
        >
          {work.text}
        </p>
      )}
    </>
  );
}

/** The controls: which script, and the one button that asks the AI about its claims. */
function RiskPanel({ risk }: { readonly risk: Risk }) {
  const check = risk.view?.check ?? null;
  return (
    <>
      <PanelTitle id="risk-check-title" title="Before you publish" lead={NOT_A_VERDICT} />
      <ScriptChoice risk={risk} />
      <PanelAction
        icon={ShieldAlert}
        disabled={risk.work.status === 'running' || check === null}
        onClick={risk.ask}
        note="One AI question about the title and thumbnail."
      >
        Check the claims
      </PanelAction>
      <WorkLine risk={risk} />
      <Details summary="How this works">
        <p className="text-body-sm text-on-surface-variant">
          Jgtube finds in code the sentences of the script that share six or more words in a row
          with a stored transcript of a look-alike on this map, and counts the facts still marked to
          check. One AI question then lists the title or thumbnail claims the script does not
          support, quoting both; Jgtube keeps a claim only when both quotes are really there.
        </p>
      </Details>
    </>
  );
}

/** Before publishing: what a script's title, thumbnail and wording are worth a second look for. */
export function RiskCheck({ channelId, openConceptId, reloadKey }: Props) {
  const risk = useRisk(channelId, openConceptId, reloadKey);
  const { view } = risk;
  if (!view) return null;
  const check = view.check;
  return (
    <ViewPage id="risk-check" labelledBy="risk-check-title">
      <ViewHeader
        title="Check"
        lead={check ? <span className="text-on-surface">{check.title}</span> : undefined}
      />
      <SplitView sideLabel="Which script to check" side={<RiskPanel risk={risk} />}>
        {check ? (
          <>
            <p className="-mt-space-sm text-body-sm text-outline">
              {stageLine(check.stage, check.transcriptsCompared)}{' '}
              {check.ai ? aiLine(check.ai, new Date()) : ''}
            </p>
            <RiskNumbers check={check} />
            <RiskLists check={check} />
          </>
        ) : (
          <Card>
            <ShieldAlert aria-hidden="true" className="h-6 w-6 text-metric-amber" />
            <p className="text-body-md text-on-surface">No script to check yet.</p>
            <p className="text-body-sm text-on-surface-variant">
              Keep an idea in Ideas and write its script; the check follows the script that is open.
            </p>
          </Card>
        )}
      </SplitView>
    </ViewPage>
  );
}
