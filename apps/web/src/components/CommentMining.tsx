import { viewHref } from '../lib/routes';
import { DisabledReason } from './layout/PanelAction';
import { MessageSquareText } from 'lucide-react';
import { useState } from 'react';
import { askedLine, quotaLine, type CommentsView } from '../lib/comments';
import { CandidateRow, FindingCard } from './CommentParts';
import { Card, Field } from './layout/Card';
import { Details } from './layout/Details';
import { PanelButton } from './layout/PanelButton';
import { SplitView, ViewPage } from './layout/SplitView';
import { ViewHeader } from './layout/ViewHeader';
import { QUIET_BUTTON } from './LabStatus';
import { useComments, type Comments } from './useComments';

/** The winners listed to choose from, strongest first. */
const CANDIDATES_SHOWN = 15;
/** Chosen at first: enough to see what recurs, at a small cost. */
const FIRST_CHOSEN = 3;

const NO_KEY = 'Add a YouTube key in Settings to read comments.';

/** Why the comments cannot be read now, in one line; null when they can. */
function readBlocked(keySet: boolean, chosen: number, busy: boolean): string | null {
  if (!keySet) return 'Needs a YouTube key in Settings.';
  if (chosen === 0) return 'Choose a video above.';
  return busy ? 'Waits for the run under way to finish.' : null;
}

/** The side panel: the winning videos to read, the quiet read button and the one question. */
function Picker({ view, comments }: { readonly view: CommentsView; readonly comments: Comments }) {
  const shown = view.candidates.slice(0, CANDIDATES_SHOWN);
  const [chosen, setChosen] = useState<readonly string[]>(() =>
    shown.slice(0, FIRST_CHOSEN).map((entry) => entry.videoId),
  );
  const toggle = (id: string) =>
    setChosen((now) =>
      now.includes(id)
        ? now.filter((other) => other !== id)
        : [...now, id].slice(0, view.maxVideos),
    );
  const busy = comments.work.status === 'running';
  const readable = chosen.filter(
    (id) => (shown.find((entry) => entry.videoId === id)?.read?.count ?? 0) > 0,
  );
  const now = new Date();
  if (shown.length === 0) {
    return (
      <p className="text-body-sm text-on-surface-variant">
        No video of a look-alike on this map counts as a winner yet.
      </p>
    );
  }
  return (
    <>
      <Field label={`Winning videos (${chosen.length} chosen)`}>
        <ul className="flex max-h-[22rem] min-w-0 flex-col gap-1.5 overflow-y-auto pr-1">
          {shown.map((entry) => (
            <CandidateRow
              key={entry.videoId}
              entry={entry}
              chosen={chosen.includes(entry.videoId)}
              onToggle={() => toggle(entry.videoId)}
              now={now}
            />
          ))}
        </ul>
        <p className="text-body-sm text-outline">{quotaLine(view, chosen.length)}</p>
      </Field>
      <button
        type="button"
        disabled={busy || !view.keySet || chosen.length === 0}
        onClick={() => comments.read(chosen)}
        className={QUIET_BUTTON}
      >
        Read comments of {chosen.length} chosen
      </button>
      <DisabledReason reason={readBlocked(view.keySet, chosen.length, busy)} />
      <PanelButton
        icon={MessageSquareText}
        disabled={busy}
        blocked={readable.length === 0 ? 'Read the comments of a video first.' : null}
        onClick={() => comments.ask(readable)}
      >
        What viewers ask for ({readable.length} with comments)
      </PanelButton>
    </>
  );
}

function Panel({ view, comments }: { readonly view: CommentsView; readonly comments: Comments }) {
  return (
    <>
      <div className="flex min-w-0 flex-col gap-1">
        <h2 className="flex items-center gap-2 text-headline-md font-bold text-on-surface">
          <MessageSquareText aria-hidden="true" className="h-5 w-5 flex-none text-metric-amber" />
          Read the comments
        </h2>
        <p className="text-body-sm text-on-surface-variant">
          Of winning videos on this map, then ask what comes up again and again.
        </p>
      </div>
      <Details summary="How this works">
        <p className="text-body-sm text-on-surface-variant">
          Reads the top comments through the official YouTube API, then one AI question lists the
          requests, questions and objections that come up again and again, each shown with the
          comments it rests on. Comments are kept on this computer; who wrote them is not.
        </p>
      </Details>
      {!view.keySet && (
        <div className="flex flex-col gap-2 rounded-lg border border-border-subtle p-space-sm">
          <p className="text-body-sm text-metric-amber">{NO_KEY}</p>
          <a href={viewHref('settings')} className="w-fit text-body-sm font-semibold text-primary">
            Open Settings
          </a>
        </div>
      )}
      <Picker key={view.centerChannelId} view={view} comments={comments} />
    </>
  );
}

function Findings({ view }: { readonly view: CommentsView }) {
  const { answer } = view;
  if (!answer) {
    return (
      <Card>
        <MessageSquareText aria-hidden="true" className="h-6 w-6 text-metric-amber" />
        <p className="text-body-md text-on-surface">Nothing asked yet.</p>
        <p className="text-body-sm text-on-surface-variant">
          Choose winning videos on the left, read their comments, then press What viewers ask for.
        </p>
      </Card>
    );
  }
  return (
    <>
      {answer.findings.length === 0 ? (
        <Card>
          <p className="text-body-md text-on-surface-variant">
            Nothing recurs in two or more of the comments read.
          </p>
        </Card>
      ) : (
        <ol className="flex min-w-0 flex-col gap-space-md">
          {answer.findings.map((finding) => (
            <FindingCard key={`${finding.kind}:${finding.says}`} finding={finding} />
          ))}
        </ol>
      )}
      <p className="text-body-sm text-outline">{askedLine(answer, new Date())}</p>
    </>
  );
}

interface Props {
  readonly channelId: string | null;
  readonly reloadKey: unknown;
}

/** Comments of the map's winning videos, and what viewers ask for in them. */
export function CommentMining({ channelId, reloadKey }: Props) {
  const comments = useComments(channelId, reloadKey);
  const { view, work, problem } = comments;
  if (!view) return null;
  const count = view.answer?.findings.length;
  return (
    <ViewPage id="comment-mining" labelledBy="comment-mining-title">
      <SplitView sideLabel="Comments to read" side={<Panel view={view} comments={comments} />}>
        <ViewHeader
          titleId="comment-mining-title"
          title="What viewers ask for"
          count={count}
          lead="Requests, questions and objections that recur in the comments of winning videos."
        />
        {problem && (
          <p role="alert" className="rounded-lg bg-surface-card p-space-md text-body-md text-error">
            {problem}
          </p>
        )}
        {work.status !== 'idle' && (
          <p
            role={work.status === 'failed' ? 'alert' : 'status'}
            className={`rounded-lg bg-surface-card p-space-md text-body-md ${
              work.status === 'failed' ? 'text-error' : 'text-on-surface-variant'
            }`}
          >
            {work.text}
          </p>
        )}
        <Findings view={view} />
      </SplitView>
    </ViewPage>
  );
}
