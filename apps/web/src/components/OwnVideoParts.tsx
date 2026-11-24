import { AddToFormat } from './AddToFormat';
import type { LinkedVideo, PlanTableRow } from '@jgtube/core';
import { formatDuration, thumbnailUrl, watchUrl } from '../lib/format';
import { KIND_LABELS, inspirationLine, medianText, scoreLine, tableCaution } from '../lib/plan';
import { Card, Label } from './layout/Card';
import { Details } from './layout/Details';
import { QUIET_BUTTON } from './LabStatus';

interface CardProps {
  readonly video: LinkedVideo;
  readonly busy: boolean;
  readonly onUnlink: () => void;
}

function VideoTitle({ video }: { readonly video: LinkedVideo }) {
  const href = watchUrl(video.videoId);
  return (
    <p className="line-clamp-2 break-words text-title-md font-semibold text-on-surface">
      {href ? (
        <a href={href} target="_blank" rel="noopener noreferrer" className="hover:text-primary">
          {video.videoTitle}
        </a>
      ) : (
        video.videoTitle
      )}
    </p>
  );
}

/** The concept's inspiration videos as they stood at the same age, behind a disclosure. */
function Inspirations({ video }: { readonly video: LinkedVideo }) {
  const count = video.inspirations.length;
  if (count === 0) {
    return <p className="text-body-sm text-outline">The idea names no inspiration videos.</p>;
  }
  return (
    <Details summary={`Its inspiration videos at the same age (${count})`}>
      <ul className="flex flex-col gap-space-sm text-body-sm text-on-surface-variant">
        {video.inspirations.map((inspiration) => (
          <li key={inspiration.videoId} className="min-w-0 break-words">
            <span className="font-semibold text-on-surface">
              {inspiration.title ?? inspiration.videoId}
            </span>
            {inspiration.channelTitle ? ` · ${inspiration.channelTitle}` : ''}:{' '}
            {inspirationLine(inspiration, video)}
          </li>
        ))}
      </ul>
      <p className="text-body-sm text-outline">
        Views of videos on channels of other sizes are not directly comparable; the score above is
        against this channel's own usual.
      </p>
    </Details>
  );
}

/** One linked video: its numbers against the channel's usual and its concept's inspirations. */
export function LinkedCard({ video, busy, onUnlink }: CardProps) {
  const thumbnail = thumbnailUrl(video.videoId);
  return (
    <Card as="li">
      <div className="flex min-w-0 flex-col gap-space-md sm:flex-row">
        <div className="aspect-video w-full flex-none overflow-hidden rounded-lg bg-surface-container-high sm:w-48">
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
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <VideoTitle video={video} />
          <p className="break-words text-body-sm text-outline">
            From the concept “{video.conceptTitle}”{video.hasScript ? ', with a script' : ''} ·{' '}
            {formatDuration(video.durationSeconds)}
          </p>
          <p className="pt-1 text-body-md text-on-surface">{scoreLine(video)}</p>
        </div>
      </div>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-space-sm">
        <Inspirations video={video} />
        <span className="flex flex-wrap items-center gap-2">
          <AddToFormat
            source={{ kind: 'video', use: 'own-video', videoId: video.videoId, center: null }}
          />
          <button type="button" disabled={busy} onClick={onUnlink} className={QUIET_BUTTON}>
            Unlink
          </button>
        </span>
      </div>
    </Card>
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
    <Card>
      <Label>What your linked videos used, and how they did</Label>
      <ul className="flex min-w-0 flex-col">
        {rows.map((row) => (
          <li
            key={`${row.kind}:${row.label}`}
            className="grid min-w-0 grid-cols-1 gap-x-space-md gap-y-0.5 border-t border-border-subtle py-2.5 first:border-t-0 sm:grid-cols-[9rem_minmax(0,1fr)_5rem_minmax(0,12rem)]"
          >
            <span className="text-label text-outline">{KIND_LABELS[row.kind]}</span>
            <span className="break-words text-body-md text-on-surface">{row.label}</span>
            <span className="text-body-sm text-on-surface-variant">
              {row.videos} {row.videos === 1 ? 'video' : 'videos'}
            </span>
            <span className="text-body-sm text-on-surface">{medianText(row)}</span>
          </li>
        ))}
      </ul>
      <p className="text-body-sm text-outline">{tableCaution(videos)}</p>
    </Card>
  );
}
