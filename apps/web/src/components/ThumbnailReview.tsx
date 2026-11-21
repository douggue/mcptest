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
  return (
    <Card as="section" label="Review one thumbnail" id={reviewAnchor(review.picked)}>
      <div className="flex min-w-0 flex-col gap-1">
        <h3 className="text-headline-md font-bold text-on-surface">Review one thumbnail</h3>
        <p className="text-body-sm text-on-surface-variant">
          Pick a video. Its thumbnail is set against the winners closest to it, what they share is
          counted, and the AI says how to improve it and writes a full prompt for it.
        </p>
      </div>
      <ThumbnailReviewPicker videos={review.videos} picked={review.picked} onPick={review.choose} />
      {review.note && <p className="text-body-sm text-outline">{review.note}</p>}
      <button
        type="button"
        onClick={review.ask}
        disabled={busy || running || review.picked === null}
        className="flex min-h-11 items-center justify-center gap-2 self-start rounded-lg bg-primary-container px-4 py-2 text-body-md font-semibold text-on-primary transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <ScanSearch aria-hidden="true" className="h-4 w-4 flex-none" />
        {running ? 'Working…' : 'Review this thumbnail'}
      </button>
      {running && <Notice tone="working">{review.work.text}</Notice>}
      {review.work.status === 'failed' && <Notice tone="problem">{review.work.text}</Notice>}
      {review.problem && <Notice tone="problem">{review.problem}</Notice>}
      {review.view && <ThumbnailReviewResult view={review.view} />}
    </Card>
  );
}
