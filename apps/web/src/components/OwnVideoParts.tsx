import type { LinkedVideo, PlanTableRow } from '@jgtube/core';
import { formatDuration, thumbnailUrl, watchUrl } from '../lib/format';
import { KIND_LABELS, inspirationLine, medianText, scoreLine, tableCaution } from '../lib/plan';
import { QUIET_BUTTON } from './LabStatus';

const LABEL = 'text-label-caps uppercase text-outline';
const CELL = 'px-space-sm py-1.5 text-left align-top';

interface CardProps {
  readonly video: LinkedVideo;
  readonly busy: boolean;
  readonly onUnlink: () => void;
}

/** One linked video: its numbers against the channel's usual and its concept's inspirations. */
export function LinkedCard({ video, busy, onUnlink }: CardProps) {
  const href = watchUrl(video.videoId);
  const thumbnail = thumbnailUrl(video.videoId);
  return (
    <article className="flex min-w-0 flex-col gap-space-sm rounded bg-surface-card p-space-md">
      <div className="flex min-w-0 gap-space-sm">
        <div className="aspect-video w-28 flex-none overflow-hidden rounded bg-surface-container-high">
          {thumbnail && (
            <img
              src={thumbnail}
              alt=""
              loading="lazy"
              referrerPolicy="no-referrer"
              className="h-full w-full object-cover"
            />
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="line-clamp-2 text-body-md font-semibold text-on-surface">
            {href ? (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-primary"
              >
                {video.videoTitle}
              </a>
            ) : (
              video.videoTitle
            )}
          </p>
          <p className="text-body-sm text-outline">
            From the concept “{video.conceptTitle}”{video.hasScript ? ', with a script' : ''} ·{' '}
            {formatDuration(video.durationSeconds)}
          </p>
        </div>
      </div>
      <p className="text-body-md text-on-surface">{scoreLine(video)}</p>
      <div className="flex flex-col gap-1">
        <h4 className={LABEL}>Its inspiration videos at the same age</h4>
        {video.inspirations.length === 0 ? (
          <p className="text-body-sm text-on-surface-variant">
            The concept names no inspiration videos.
          </p>
        ) : (
          <ul className="flex flex-col gap-1 text-body-sm text-on-surface-variant">
            {video.inspirations.map((inspiration) => (
              <li key={inspiration.videoId} className="min-w-0">
                <span className="font-semibold text-on-surface">
                  {inspiration.title ?? inspiration.videoId}
                </span>
                {inspiration.channelTitle ? ` · ${inspiration.channelTitle}` : ''}:{' '}
                {inspirationLine(inspiration, video)}
              </li>
            ))}
          </ul>
        )}
        <p className="text-body-sm text-outline">
          Views of videos on channels of other sizes are not directly comparable; the score above is
          against this channel's own usual.
        </p>
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={onUnlink}
        className={`self-start ${QUIET_BUTTON}`}
      >
        Unlink
      </button>
    </article>
  );
}

/** Every linked video counted by format, hook style and length, and how each did. */
export function PlanTable({
  rows,
  videos,
}: {
  readonly rows: readonly PlanTableRow[];
  readonly videos: number;
}) {
  return (
    <div className="flex flex-col gap-space-sm">
      <h3 className={LABEL}>What your linked videos used, and how they did</h3>
      <div className="overflow-x-auto rounded bg-surface-card">
        <table className="w-full min-w-[520px] text-body-sm text-on-surface">
          <thead className="text-label-caps uppercase text-outline">
            <tr>
              <th className={CELL}>Kind</th>
              <th className={CELL}>Used</th>
              <th className={CELL}>Videos</th>
              <th className={CELL}>Outlier score</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={`${row.kind}:${row.label}`}
                className="border-t border-surface-container-high"
              >
                <td className={`${CELL} text-on-surface-variant`}>{KIND_LABELS[row.kind]}</td>
                <td className={CELL}>{row.label}</td>
                <td className={CELL}>{row.videos}</td>
                <td className={CELL}>{medianText(row)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-body-sm text-outline">{tableCaution(videos)}</p>
    </div>
  );
}
