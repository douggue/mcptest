import { FINDING_LABELS, readLine, type CandidateView, type FindingView } from '../lib/comments';
import { formatCount, formatScore, thumbnailUrl, watchUrl } from '../lib/format';
import { Card } from './layout/Card';
import { Details } from './layout/Details';
import { PILL } from './LabStatus';

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
  const thumbnail = thumbnailUrl(entry.videoId);
  return (
    <li
      className={`flex min-w-0 items-start gap-space-sm rounded-lg border p-2.5 ${
        chosen ? 'border-border-highlight bg-surface-card' : 'border-border-subtle bg-space-deep'
      }`}
    >
      <input
        type="checkbox"
        checked={chosen}
        onChange={onToggle}
        aria-label={`Choose ${entry.title}`}
        className="mt-1 h-4 w-4 flex-none accent-primary-container"
      />
      {thumbnail && (
        <img
          src={thumbnail}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          className="aspect-video w-16 flex-none rounded bg-surface-container-high object-cover"
        />
      )}
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="line-clamp-2 break-words text-body-sm font-semibold text-on-surface">
          {href ? (
            <a href={href} target="_blank" rel="noopener noreferrer" className="hover:text-primary">
              {entry.title}
            </a>
          ) : (
            entry.title
          )}
        </p>
        <p className="break-words text-body-sm text-outline">
          {entry.channelTitle} · {formatScore(entry.score)} · {formatCount(entry.views)} views ·{' '}
          {readLine(entry.read, now)}
        </p>
      </div>
    </li>
  );
}

type StoredComment = FindingView['comments'][number];

function Comment({ comment }: { readonly comment: StoredComment }) {
  return (
    <li className="border-l-2 border-border-subtle pl-space-sm text-body-sm text-on-surface-variant">
      <p className="line-clamp-4 break-words">“{comment.text}”</p>
      <p className="text-outline">
        A viewer · {comment.likes} likes · id {comment.commentId}
      </p>
    </li>
  );
}

/** One recurring request, question or objection: the first comment it rests on, the rest closed. */
export function FindingCard({ finding }: { readonly finding: FindingView }) {
  const [first, ...rest] = finding.comments;
  return (
    <Card as="li">
      <div className="flex min-w-0 flex-col items-start gap-2">
        <span className={`${PILL} text-on-surface-variant`}>{FINDING_LABELS[finding.kind]}</span>
        <h3 className="break-words text-title-md font-semibold text-on-surface">{finding.says}</h3>
      </div>
      {first && (
        <ul className="flex flex-col gap-space-sm">
          <Comment comment={first} />
        </ul>
      )}
      {rest.length > 0 && (
        <Details
          summary={`${rest.length} more ${rest.length === 1 ? 'comment' : 'comments'} it rests on`}
        >
          <ul className="flex flex-col gap-space-sm">
            {rest.map((comment) => (
              <Comment key={comment.commentId} comment={comment} />
            ))}
          </ul>
        </Details>
      )}
    </Card>
  );
}
