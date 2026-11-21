import { Bell, Check } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  alertLine,
  freshnessNote,
  parseMinScore,
  ruleSummary,
  type AlertsReply,
  type AlertView,
} from '../lib/alerts';
import { channelUrl, thumbnailUrl, watchUrl } from '../lib/format';
import { FIELD, NOTE, PRIMARY_BUTTON, QUIET_BUTTON } from './LabStatus';
import type { Alerts } from './useAlerts';

const LABEL = 'text-label-caps uppercase text-outline';

function AlertItem({ alert }: { readonly alert: AlertView }) {
  const video = alert.kind === 'breakout';
  const href = video ? watchUrl(alert.subjectId) : channelUrl(alert.channelId);
  const thumbnail = video ? thumbnailUrl(alert.subjectId) : null;
  return (
    <li className="flex min-w-0 gap-space-sm rounded bg-surface-card p-space-sm">
      {thumbnail && (
        <div className="aspect-video w-24 flex-none overflow-hidden rounded bg-surface-container-high">
          <img
            src={thumbnail}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            className="h-full w-full object-cover"
          />
        </div>
      )}
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="line-clamp-2 text-body-md font-semibold text-on-surface">
          {!alert.read && (
            <span
              className="mr-1.5 inline-block h-2 w-2 rounded-full bg-primary"
              aria-label="New"
            />
          )}
          {href ? (
            <a href={href} target="_blank" rel="noopener noreferrer" className="hover:text-primary">
              {alert.videoTitle ?? alert.channelTitle}
            </a>
          ) : (
            (alert.videoTitle ?? alert.channelTitle)
          )}
        </p>
        <p className="text-body-sm text-on-surface-variant">{alertLine(alert)}</p>
        <p className="text-body-sm text-outline">
          Found {new Date(alert.foundAt).toLocaleString()}
        </p>
      </div>
    </li>
  );
}

interface FormProps {
  readonly reply: AlertsReply;
  readonly onSave: Alerts['save'];
}

/** The rule for the channel on screen: the owner's number and what counts. */
function RuleForm({ reply, onSave }: FormProps) {
  const { rule, defaultMinScore, minMinScore, maxMinScore } = reply;
  const [text, setText] = useState(String(rule?.minScore ?? defaultMinScore));
  const [takenOff, setTakenOff] = useState(rule?.takenOff ?? true);
  const [enabled, setEnabled] = useState(rule?.enabled ?? true);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    setText(String(rule?.minScore ?? defaultMinScore));
    setTakenOff(rule?.takenOff ?? true);
    setEnabled(rule?.enabled ?? true);
  }, [rule, defaultMinScore]);

  const submit = () => {
    const parsed = parseMinScore(text, minMinScore, maxMinScore);
    if (!parsed.ok) {
      setProblem(parsed.message);
      return;
    }
    setProblem(null);
    onSave({ minScore: parsed.value, takenOff, enabled });
  };

  return (
    <form
      className="flex flex-wrap items-end gap-space-sm"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <label className="flex w-36 flex-col gap-1">
        <span className={LABEL}>Video at (× usual)</span>
        <input
          type="number"
          inputMode="decimal"
          step="0.5"
          min={minMinScore}
          max={maxMinScore}
          value={text}
          onChange={(event) => setText(event.target.value)}
          className={FIELD}
        />
      </label>
      <label className="flex items-center gap-2 text-body-sm text-on-surface">
        <input
          type="checkbox"
          checked={takenOff}
          onChange={(event) => setTakenOff(event.target.checked)}
          className="h-4 w-4 accent-primary-container"
        />
        A look-alike newly takes off
      </label>
      <label className="flex items-center gap-2 text-body-sm text-on-surface">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => setEnabled(event.target.checked)}
          className="h-4 w-4 accent-primary-container"
        />
        Alerts on
      </label>
      <button type="submit" className={PRIMARY_BUTTON}>
        Save rule
      </button>
      {problem && (
        <p role="alert" className="w-full text-body-sm text-error">
          {problem}
        </p>
      )}
    </form>
  );
}

/** Alerts for the channel on screen, under what changed. */
export function AlertsPanel({ alerts }: { readonly alerts: Alerts }) {
  const { state, save, markRead } = alerts;
  if (state.status === 'idle') return null;
  const reply = state.status === 'ready' ? state.reply : null;
  return (
    <div role="group" aria-labelledby="alerts-title" className="flex min-w-0 flex-col gap-space-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="alerts-title" className={`flex items-center gap-1.5 ${LABEL}`}>
          <Bell aria-hidden="true" className="h-4 w-4" />
          Alerts{reply && reply.unread > 0 ? ` (${reply.unread} new)` : ''}
        </h3>
        {reply && reply.unread > 0 && (
          <button
            type="button"
            onClick={markRead}
            className={`flex items-center gap-1.5 ${QUIET_BUTTON}`}
          >
            <Check aria-hidden="true" className="h-4 w-4" />
            Mark alerts read
          </button>
        )}
      </div>
      {state.status === 'loading' && <p className={NOTE}>Reading the alerts</p>}
      {state.status === 'failed' && (
        <p role="alert" className="text-body-sm text-error">
          Alerts could not be loaded: {state.message}
        </p>
      )}
      {reply && (
        <>
          <p className="text-body-md text-on-surface-variant">
            {ruleSummary(reply.rule, reply.defaultMinScore)}
          </p>
          <RuleForm reply={reply} onSave={save} />
          {state.status === 'ready' && state.problem && (
            <p role="alert" className="text-body-sm text-error">
              {state.problem}
            </p>
          )}
          {reply.alerts.length === 0 ? (
            <p className={NOTE}>No alerts yet.</p>
          ) : (
            <ul className="grid grid-cols-1 gap-space-sm lg:grid-cols-2">
              {reply.alerts.map((alert) => (
                <AlertItem key={alert.id} alert={alert} />
              ))}
            </ul>
          )}
          <p className="text-body-sm text-outline">
            {freshnessNote(reply.lastRefreshAt, new Date())}
          </p>
        </>
      )}
    </div>
  );
}
