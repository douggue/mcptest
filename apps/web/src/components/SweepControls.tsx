import { READING_BUDGET_HELP } from '@jgtube/core/src/sweep/budget';
import {
  budgetLine,
  budgetOptions,
  costLine,
  scheduleDays,
  scheduleOptions,
  scheduleValue,
  summaryRows,
  sweepHeadline,
  type SweepReply,
  type SweepRunView,
} from '../lib/sweep';
import { QUIET_BUTTON } from './LabStatus';
import { Details } from './layout/Details';
import { Notice } from './layout/Notice';
import type { SweepRun } from './useSweep';

const SELECT =
  'min-h-11 min-w-0 max-w-full rounded border border-border-subtle bg-space-deep px-3 text-body-md text-on-surface';
const NOTE = 'text-body-sm text-outline';

/** What the last sweep did: one line, and each keyword's numbers behind a disclosure. */
function LastSweep({ last }: { readonly last: SweepRunView }) {
  const rows = summaryRows(last);
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <p className="text-body-sm text-on-surface-variant">{sweepHeadline(last)}</p>
      {rows.length > 0 && (
        <Details summary="What each keyword found">
          <ul className="flex min-w-0 flex-col gap-1">
            {rows.map((row) => (
              <li
                key={row.name}
                className="flex min-w-0 flex-col text-body-sm sm:flex-row sm:gap-2"
              >
                <span className="min-w-0 truncate text-on-surface sm:flex-1">{row.name}</span>
                <span className="text-outline">
                  {row.read} read · {row.qualified} qualified · {row.requests}
                </span>
              </li>
            ))}
          </ul>
        </Details>
      )}
    </div>
  );
}

interface SettingsProps {
  readonly info: SweepReply;
  readonly onSave: (everyDays: number | null, pageBudget: number) => void;
}

/** The schedule and the reading budget per day. */
function Settings({ info, onSave }: SettingsProps) {
  const { everyDays, pageBudget } = info.settings;
  return (
    <div className="flex min-w-0 flex-col gap-space-sm">
      <div className="flex min-w-0 flex-wrap gap-space-md">
        <label className="flex min-w-0 flex-col gap-1 text-body-sm text-outline">
          Sweep on a schedule
          <select
            value={scheduleValue(everyDays)}
            onChange={(event) => onSave(scheduleDays(event.target.value), pageBudget)}
            className={SELECT}
          >
            {scheduleOptions(everyDays).map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-body-sm text-outline">
          YouTube reading budget per day
          <select
            value={pageBudget}
            onChange={(event) => onSave(everyDays, Number(event.target.value))}
            className={SELECT}
            aria-describedby="reading-budget-help"
          >
            {budgetOptions(pageBudget).map((pages) => (
              <option key={pages} value={pages}>
                {pages.toLocaleString('en')} page requests
              </option>
            ))}
          </select>
        </label>
      </div>
      <p id="reading-budget-help" className={NOTE}>
        {READING_BUDGET_HELP}
      </p>
      {everyDays !== null && (
        <p className={NOTE}>
          A scheduled sweep runs while Jgtube is open, never beside a map or a refresh.
        </p>
      )}
    </div>
  );
}

interface Props extends SettingsProps {
  readonly run: SweepRun;
  readonly onStart: () => void;
}

/** "Sweep now" with its cost said first, today's budget, the schedule and the last sweep. */
export function SweepControls({ info, run, onStart, onSave }: Props) {
  const running = run.status === 'running';
  return (
    <div className="flex min-w-0 flex-col gap-space-sm">
      <p className="text-body-sm text-on-surface-variant">{costLine(info)}</p>
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onStart}
          disabled={running || info.cannotStart !== null}
          className={`min-h-11 ${QUIET_BUTTON}`}
        >
          {running ? 'Sweeping…' : 'Sweep now'}
        </button>
        <span className={NOTE}>{budgetLine(info)}</span>
      </div>
      {!running && info.cannotStart !== null && info.keywords.length > 0 && (
        <p className="text-body-sm text-metric-amber">{info.cannotStart}</p>
      )}
      {running && (
        <Notice tone="working">{run.step}. It runs in Working; you can leave this page.</Notice>
      )}
      {run.status === 'failed' && <Notice tone="problem">{run.message}</Notice>}
      {!running && info.last && <LastSweep last={info.last} />}
      <Details summary="Schedule and budget">
        <Settings info={info} onSave={onSave} />
      </Details>
    </div>
  );
}
