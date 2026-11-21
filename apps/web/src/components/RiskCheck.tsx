import { ShieldAlert } from 'lucide-react';
import { aiLine, NOT_A_VERDICT, stageLine } from '../lib/risk';
import { FIELD, NOTE, PRIMARY_BUTTON } from './LabStatus';
import { RiskLists } from './RiskParts';
import { SectionFrame } from './SectionFrame';
import { useRisk } from './useRisk';

interface Props {
  readonly channelId: string | null;
  /** The concept the script writer has open, which the check follows. */
  readonly openConceptId: number | null;
  readonly reloadKey: unknown;
}

/** Before publishing: what a script's title, thumbnail and wording are worth a second look for. */
export function RiskCheck({ channelId, openConceptId, reloadKey }: Props) {
  const risk = useRisk(channelId, openConceptId, reloadKey);
  const { view, work } = risk;
  if (!view) return null;
  const check = view.check;
  const busy = work.status === 'running';
  return (
    <SectionFrame
      id="risk-check"
      titleId="risk-check-title"
      title="Check before publishing"
      icon={ShieldAlert}
      lead={NOT_A_VERDICT}
      howItWorks={
        <p>
          Jgtube finds in code the sentences of the script that share six or more words in a row
          with a stored transcript of a look-alike on this map, and counts the facts still marked to
          check. One AI question then lists the title or thumbnail claims the script does not
          support, quoting both; Jgtube keeps a claim only when both quotes are really there.
        </p>
      }
      actions={
        <button
          type="button"
          disabled={busy || check === null}
          onClick={risk.ask}
          className={PRIMARY_BUTTON}
        >
          Check the claims
        </button>
      }
    >
      {view.concepts.length === 0 ? (
        <p className={NOTE}>
          No kept concept has a script yet. Write one in the script writer first.
        </p>
      ) : (
        <label className="flex max-w-xl flex-col gap-1">
          <span className="text-label-caps uppercase text-outline">Script</span>
          <select
            value={risk.conceptId ?? ''}
            onChange={(event) => risk.choose(Number(event.target.value))}
            className={FIELD}
          >
            {view.concepts.map((entry) => (
              <option key={entry.conceptId} value={entry.conceptId}>
                {entry.title}
              </option>
            ))}
          </select>
        </label>
      )}
      {risk.problem && (
        <p role="alert" className="text-body-md text-error">
          {risk.problem}
        </p>
      )}
      {work.status !== 'idle' && (
        <p
          role={work.status === 'failed' ? 'alert' : 'status'}
          className={
            work.status === 'failed'
              ? 'text-body-md text-error'
              : 'text-body-md text-on-surface-variant'
          }
        >
          {work.text}
        </p>
      )}
      {check && (
        <>
          <p className="text-body-sm text-outline">
            {stageLine(check.stage, check.transcriptsCompared)}{' '}
            {check.ai ? aiLine(check.ai, new Date()) : ''}
          </p>
          <RiskLists check={check} />
        </>
      )}
    </SectionFrame>
  );
}
