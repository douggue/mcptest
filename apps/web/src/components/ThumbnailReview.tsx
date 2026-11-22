import { pickList } from '../lib/thumbReview';
import { PANEL_BUTTON } from './layout/PanelAction';
import { ScanSearch } from 'lucide-react';
import type { EngineChoice, EngineReport } from '../lib/analyses';
import { reviewAnchor } from '../lib/thumbReview';
import { Card } from './layout/Card';
import { Notice } from './layout/Notice';
import { ThumbnailReviewPicker } from './ThumbnailReviewPicker';
import { ThumbnailReviewResult } from './ThumbnailReviewResult';
import { useThumbnailReview } from './useThumbnailReview';

interface Props {
  readonly channelId: string;
  readonly choice: EngineChoice;
  readonly engines: EngineReport | null;
  /** Another AI run is under way: one at a time. */
  readonly busy: boolean;
}

/**
 * Review one thumbnail: pick a video, and Jgtube sets its thumbnail against
 * the winners closest to it, counts what they share, and has the AI say how
 * to improve it, with a full prompt for an image tool.
 */
export function ThumbnailReview({ channelId, choice, engines, busy }: Props) {
  const review = useThumbnailReview(channelId, choice, engines);
  const running = review.work.status === 'running';
  const pickedTitle = pickList(review.videos).find(
    (video) => video.videoId === review.picked,
  )?.title;
  return (
    <Card as="section" label="Review one thumbnail" id={reviewAnchor(review.picked)}>
      <div className="flex min-w-0 flex-col gap-1">
        <h3 className="text-headline-md font-bold text-on-surface">Review one thumbnail</h3>
        <p className="text-body-sm text-on-surface-variant">
          Pick a video. Its thumbnail is set against the winners closest to it, what they share is
          counted, and the AI says how to improve it and writes a full prompt for it.
        </p>
      </div>
      {/* The picked video and the one button sit above the grid, so the button is never below it. */}
      <div className="flex min-w-0 flex-wrap items-center gap-space-sm rounded border border-border-subtle bg-surface-container-low p-space-sm">
        <p className="min-w-0 flex-1 basis-48 truncate text-body-md text-on-surface">
          {pickedTitle ? (
            <>
              Picked: <span className="font-semibold">{pickedTitle}</span>
            </>
          ) : (
            <span className="text-on-surface-variant">Pick a video below.</span>
          )}
        </p>
        <button
          type="button"
          onClick={review.ask}
          disabled={busy || running || review.picked === null}
          className={`flex-none ${PANEL_BUTTON.replace('w-full ', '')}`}
        >
          <ScanSearch aria-hidden="true" className="h-4 w-4 flex-none" />
          {running ? 'Working…' : 'Review this thumbnail'}
        </button>
      </div>
      <ThumbnailReviewPicker videos={review.videos} picked={review.picked} onPick={review.choose} />
      {review.note && <p className="text-body-sm text-outline">{review.note}</p>}
      {running && <Notice tone="working">{review.work.text}</Notice>}
      {review.work.status === 'failed' && <Notice tone="problem">{review.work.text}</Notice>}
      {review.problem && <Notice tone="problem">{review.problem}</Notice>}
      {review.view && <ThumbnailReviewResult view={review.view} />}
    </Card>
  );
}
