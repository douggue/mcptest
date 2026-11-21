import { FINDING_LABELS, readLine, type CandidateView, type FindingView } from '../lib/comments';
import { formatCount, formatScore, watchUrl } from '../lib/format';

/** One winning video to choose, with what is known of its comments. */
export function CandidateRow({
  entry,
  chosen,
  onToggle,
  now,
}: {
  readonly entry: CandidateView;
  readonly chosen: boolean;
  readonly onToggle: () => void;
  readonly now: Date;
}) {
  const href = watchUrl(entry.videoId);
  return (
    <li className="flex min-w-0 items-start gap-space-sm rounded bg-surface-card p-space-sm">
      <input
        type="checkbox"
        checked={chosen}
        onChange={onToggle}
        aria-label={`Choose ${entry.title}`}
        className="mt-1 h-4 w-4 flex-none accent-primary-container"
      />
      <div className="min-w-0">
        <p className="line-clamp-2 text-body-md font-semibold text-on-surface">
          {href ? (
            <a href={href} target="_blank" rel="noopener noreferrer" className="hover:text-primary">
              {entry.title}
            </a>
          ) : (
            entry.title
          )}
        </p>
        <p className="text-body-sm text-outline">
          {entry.channelTitle} · {formatScore(entry.score)} · {formatCount(entry.views)} views ·{' '}
          {readLine(entry.read, now)}
        </p>
      </div>
    </li>
  );
}

/** One recurring request, question or objection, with the stored comments it rests on. */
export function FindingCard({ finding }: { readonly finding: FindingView }) {
  return (
    <article className="flex min-w-0 flex-col gap-space-sm rounded bg-surface-card p-space-md">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-surface-container-high px-2 py-0.5 text-label-caps text-on-surface-variant">
          {FINDING_LABELS[finding.kind]}
        </span>
        <p className="text-body-md font-semibold text-on-surface">{finding.says}</p>
      </div>
      <ul className="flex flex-col gap-1">
        {finding.comments.map((comment) => (
          <li
            key={comment.commentId}
            className="border-l-2 border-surface-container-high pl-space-sm text-body-sm text-on-surface-variant"
          >
            <p className="line-clamp-4 break-words">“{comment.text}”</p>
            <p className="text-outline">
              A viewer · {comment.likes} likes · id {comment.commentId}
            </p>
          </li>
        ))}
      </ul>
    </article>
  );
}
