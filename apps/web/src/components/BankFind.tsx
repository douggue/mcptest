import { useEffect, useState, type FormEvent } from 'react';
import {
  BANK_FIND_DEFAULT_CHANNELS,
  BANK_FIND_MAX_CHANNELS,
  topicQuery,
} from '@jgtube/core/src/bank/cost';
import { costLine, createBankApi, type FindInfo, type FindResult } from '../lib/bank';
import { followJob } from '../lib/requests';
import { Notice } from './layout/Notice';
import { Segmented } from './layout/Segmented';

const bankApi = createBankApi();
const POLL_MS = 2000;
const SIZES = [5, BANK_FIND_DEFAULT_CHANNELS, 15, BANK_FIND_MAX_CHANNELS];
const FIELD =
  'min-h-11 w-full min-w-0 rounded-full border border-border-subtle bg-space-deep px-4 text-body-md text-on-surface placeholder:text-outline';

type Run =
  | { readonly status: 'idle' }
  | { readonly status: 'running'; readonly step: string }
  | { readonly status: 'done'; readonly result: FindResult }
  | { readonly status: 'failed'; readonly message: string };

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

function summary(result: FindResult): string {
  const added = result.bankAfter - result.bankBefore;
  const failed = result.failed > 0 ? `, ${result.failed} could not be read` : '';
  return `Read ${result.channelsRead} new channels (${result.alreadyKnown} already read today${failed}). The bank went from ${result.bankBefore.toLocaleString('en')} to ${result.bankAfter.toLocaleString('en')} videos (+${added.toLocaleString('en')}).`;
}

/** Follows a find under way, here or after a reload, until it ends. */
function useFindRun(onGrown: () => void) {
  const [run, setRun] = useState<Run>({ status: 'idle' });
  const [jobId, setJobId] = useState<string | null>(null);
  useEffect(() => {
    if (jobId === null) return undefined;
    return followJob({
      read: () => bankApi.job(jobId),
      intervalMs: POLL_MS,
      onReading: (job) => {
        if (job.status === 'running') {
          setRun({ status: 'running', step: job.progress?.text ?? 'Starting' });
          return false;
        }
        if (job.status === 'done' && job.result) {
          setRun({ status: 'done', result: job.result });
          onGrown();
        } else {
          setRun({ status: 'failed', message: job.error ?? 'The find did not finish.' });
        }
        setJobId(null);
        return true;
      },
      onLost: (error) => setRun({ status: 'failed', message: messageOf(error) }),
    });
  }, [jobId, onGrown]);
  const follow = (id: string) => {
    setRun({ status: 'running', step: 'Starting' });
    setJobId(id);
  };
  return { run, setRun, follow };
}

/** "Find more outliers": search by keyword or topic, said what it costs before it starts. */
export function BankFind({ onGrown }: { readonly onGrown: () => void }) {
  const [mode, setMode] = useState<'keyword' | 'topic'>('keyword');
  const [keyword, setKeyword] = useState('');
  const [topic, setTopic] = useState('');
  const [channels, setChannels] = useState(BANK_FIND_DEFAULT_CHANNELS);
  const [info, setInfo] = useState<FindInfo | null>(null);
  const { run, setRun, follow } = useFindRun(onGrown);
  const running = run.status === 'running';

  useEffect(() => {
    let live = true;
    bankApi
      .findInfo(channels)
      .then((found) => {
        if (!live) return;
        setInfo(found);
        if (found.jobId && run.status === 'idle') follow(found.jobId);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
    // Asked again when the size changes or a run ends; following is started once.
  }, [channels, running]);

  const query = mode === 'keyword' ? keyword.trim() : topicQuery(topic || (info?.topics[0] ?? ''));
  const spend = info ? (info.plan.via === 'api' ? info.plan.apiUnits : info.plan.requests) : 0;
  const capped = info !== null && spend > info.allowance.left;
  const start = (event: FormEvent) => {
    event.preventDefault();
    if (query === '' || capped) return;
    bankApi
      .startFind(query, channels)
      .then(follow, (error: unknown) => setRun({ status: 'failed', message: messageOf(error) }));
  };
  return (
    <form
      onSubmit={start}
      className="flex min-w-0 flex-col gap-space-sm rounded-lg bg-surface-card p-space-md"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Segmented<'keyword' | 'topic'>
          label="Search by"
          options={[
            { value: 'keyword', label: 'Keyword' },
            { value: 'topic', label: 'Topic' },
          ]}
          value={mode}
          onChange={setMode}
        />
        <label className="flex items-center gap-2 text-body-sm text-outline">
          Channels
          <select
            value={channels}
            onChange={(event) => setChannels(Number(event.target.value))}
            className="min-h-10 rounded-full border border-border-subtle bg-space-deep px-3 text-body-sm text-on-surface"
          >
            {SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
      </div>
      {mode === 'keyword' ? (
        <input
          value={keyword}
          maxLength={200}
          onChange={(event) => setKeyword(event.target.value)}
          placeholder="A subject, e.g. abandoned megaprojects"
          aria-label="Keyword"
          className={FIELD}
        />
      ) : (
        <select
          value={topic}
          onChange={(event) => setTopic(event.target.value)}
          aria-label="Topic"
          className={FIELD}
        >
          {(info?.topics ?? []).map((label) => (
            <option key={label} value={label}>
              {label}
            </option>
          ))}
        </select>
      )}
      <p className="text-body-sm text-outline">{info ? costLine(info) : 'Working out the cost…'}</p>
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={query === '' || capped || run.status === 'running'}
          className="min-h-11 rounded-full bg-primary-container px-5 text-body-sm font-semibold text-space-deep transition-colors hover:bg-primary disabled:cursor-not-allowed disabled:opacity-50"
        >
          {run.status === 'running' ? 'Finding…' : 'Find more outliers'}
        </button>
        {capped && (
          <span className="text-body-sm text-outline">
            Today’s cap is nearly used: read fewer channels.
          </span>
        )}
      </div>
      {run.status === 'running' && (
        <Notice tone="working">{run.step}. It runs in Working; you can leave this page.</Notice>
      )}
      {run.status === 'done' && <Notice>{summary(run.result)}</Notice>}
      {run.status === 'failed' && <Notice tone="problem">{run.message}</Notice>}
    </form>
  );
}
