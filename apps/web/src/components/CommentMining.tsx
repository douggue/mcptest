import { MessageSquareText } from 'lucide-react';
import { useState } from 'react';
import { askedLine, quotaLine, type CommentsView } from '../lib/comments';
import { CandidateRow, FindingCard } from './CommentParts';
import { NOTE, PRIMARY_BUTTON, QUIET_BUTTON } from './LabStatus';
import { useComments, type Comments } from './useComments';

/** The winners listed to choose from, strongest first. */
const CANDIDATES_SHOWN = 15;
/** Chosen at first: enough to see what recurs, at a small cost. */
const FIRST_CHOSEN = 3;

const NO_KEY =
  'No YouTube API key is set. Comments can only be read through the official YouTube API: add a key in Settings, then read the comments here.';

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
  if (shown.length === 0)
    return <p className={NOTE}>No video of a look-alike on this map counts as a winner yet.</p>;
  return (
    <div className="flex flex-col gap-space-sm">
      <ul className="grid grid-cols-1 gap-space-sm lg:grid-cols-2">
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
      <div className="flex flex-wrap gap-space-sm">
        <button
          type="button"
          disabled={busy || !view.keySet || chosen.length === 0}
          onClick={() => comments.read(chosen)}
          className={QUIET_BUTTON}
        >
          Read comments of {chosen.length} chosen
        </button>
        <button
          type="button"
          disabled={busy || readable.length === 0}
          onClick={() => comments.ask(readable)}
          className={PRIMARY_BUTTON}
        >
          What viewers ask for ({readable.length} with comments)
        </button>
      </div>
    </div>
  );
}

function Answer({ view }: { readonly view: CommentsView }) {
  const { answer } = view;
  if (!answer) return null;
  return (
    <div className="flex flex-col gap-space-sm">
      <h3 className="text-label-caps uppercase text-outline">What viewers ask for</h3>
      {answer.findings.length === 0 ? (
        <p className={NOTE}>Nothing recurs in two or more of the comments read.</p>
      ) : (
        <div className="grid grid-cols-1 gap-space-md lg:grid-cols-2">
          {answer.findings.map((finding) => (
            <FindingCard key={`${finding.kind}:${finding.says}`} finding={finding} />
          ))}
        </div>
      )}
      <p className="text-body-sm text-outline">{askedLine(answer, new Date())}</p>
    </div>
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
  return (
    <section
      id="comment-mining"
      aria-labelledby="comment-mining-title"
      className="w-full scroll-mt-16 bg-space-deep px-gutter-desktop pb-space-xl"
    >
      <div className="mx-auto flex max-w-[1440px] flex-col gap-space-lg">
        <div>
          <div className="flex items-center gap-2">
            <MessageSquareText
              aria-hidden="true"
              className="h-[22px] w-[22px] flex-none text-metric-amber"
            />
            <h2
              id="comment-mining-title"
              className="text-headline-lg font-bold tracking-tight text-on-surface"
            >
              Comments: what viewers ask for
            </h2>
          </div>
          <p className="mt-1 max-w-4xl text-body-md text-on-surface-variant">
            Reads the top comments of winning videos on this map through the official YouTube API,
            then one AI question lists the requests, questions and objections that come up again and
            again, each shown with the comments it rests on. Comments are kept on this computer; who
            wrote them is not.
          </p>
        </div>
        {!view.keySet && <p className={NOTE}>{NO_KEY}</p>}
        {problem && (
          <p role="alert" className="text-body-md text-error">
            {problem}
          </p>
        )}
        <Picker key={view.centerChannelId} view={view} comments={comments} />
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
        <Answer view={view} />
      </div>
    </section>
  );
}
