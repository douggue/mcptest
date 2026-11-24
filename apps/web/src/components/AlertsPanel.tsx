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
import { Card, Label } from './layout/Card';
import { Details } from './layout/Details';
import { NewNichesEntry } from './NewNichesEntry';
import { Notice } from './layout/Notice';
import { FIELD, PRIMARY_BUTTON, QUIET_BUTTON } from './LabStatus';
import type { Alerts } from './useAlerts';

const LABEL = 'text-label text-outline';

function AlertItem({ alert }: { readonly alert: AlertView }) {
  const video = alert.kind === 'breakout';
  const href = video ? watchUrl(alert.subjectId) : channelUrl(alert.channelId);
  const thumbnail = video ? thumbnailUrl(alert.subjectId) : null;
  return (
    <li className="flex min-w-0 gap-space-sm rounded-lg bg-space-deep p-space-sm">
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
      className="flex min-w-0 flex-col gap-space-md"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <label className="flex w-40 flex-col gap-1">
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
      <button type="submit" className={`self-start ${PRIMARY_BUTTON}`}>
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

/** The alerts found so far, newest first, or a line saying there are none. */
function AlertList({ reply }: { readonly reply: AlertsReply }) {
  if (reply.alerts.length === 0) {
    return <p className="text-body-md text-on-surface-variant">No alerts yet.</p>;
  }
  return (
    <ul className="flex flex-col gap-space-sm">
      {reply.alerts.map((alert) => (
        <AlertItem key={alert.id} alert={alert} />
      ))}
    </ul>
  );
}

/** Alerts for the channel on screen, beside what changed: the rule behind a disclosure, then the alerts. */
export function AlertsPanel({ alerts }: { readonly alerts: Alerts }) {
  const { state, save, markRead } = alerts;
  if (state.status === 'idle') return null;
  const reply = state.status === 'ready' ? state.reply : null;
  return (
    <section aria-labelledby="alerts-title" className="min-w-0">
      <Card>
        <Label
          action={
            reply &&
            reply.unread > 0 && (
              <button
                type="button"
                onClick={markRead}
                className={`flex items-center gap-1.5 ${QUIET_BUTTON}`}
              >
                <Check aria-hidden="true" className="h-4 w-4" />
                Mark alerts read
              </button>
            )
          }
        >
          <span id="alerts-title" className="flex items-center gap-1.5">
            <Bell aria-hidden="true" className="h-4 w-4" />
            Alerts{reply && reply.unread > 0 ? ` (${reply.unread} new)` : ''}
          </span>
        </Label>
        {state.status === 'loading' && <Notice tone="working">Reading the alerts</Notice>}
        {state.status === 'failed' && (
          <Notice tone="problem">Alerts could not be loaded: {state.message}</Notice>
        )}
        {reply && (
          <>
            <p className="text-body-md text-on-surface">
              {ruleSummary(reply.rule, reply.defaultMinScore)}
            </p>
            <Details summary={reply.rule ? 'Change the rule' : 'Set the rule'}>
              <RuleForm reply={reply} onSave={save} />
            </Details>
            {state.status === 'ready' && state.problem && (
              <p role="alert" className="text-body-sm text-error">
                {state.problem}
              </p>
            )}
            <NewNichesEntry count={reply.newNiches?.count ?? 0} />
            <AlertList reply={reply} />
            <p className="text-body-sm text-outline">
              {freshnessNote(reply.lastRefreshAt, new Date())}
            </p>
          </>
        )}
      </Card>
    </section>
  );
}
