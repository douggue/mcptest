import { Captions, Film, ScanSearch } from 'lucide-react';
import { useEffect } from 'react';
import { sendingText } from '../../lib/breakdown';
import { viewHref } from '../../lib/routes';
import { watchUrl } from '../../lib/format';
import { writtenText, type VideoBreakdownView } from '../../lib/videoBreakdown';
import { HookCard } from '../HookCard';
import { Notice } from '../layout/Notice';
import { HookSection } from '../teardown/TeardownLook';
import { ThumbnailReviewResult } from '../ThumbnailReviewResult';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { EmptyState } from '../ui/States';
import { useRunsLine } from '../useRunsLine';
import { useThumbnailReview } from '../useThumbnailReview';
import type { VideoBreakdown } from '../useVideoBreakdown';
import { TeardownDownloads, TeardownResult } from '../VideoTeardown';
import type { ViewParts } from '../viewParts';

/** What the run under way is doing, or why the last one stopped. */
function RunStatus({ video }: { readonly video: VideoBreakdown }) {
  const { run } = video;
  if (run.status === 'sending') {
    return <Notice tone="working">{`${run.name}: ${sendingText(run.fraction)}`}</Notice>;
  }
  if (run.status === 'running') {
    return (
      <Notice tone="working">{`${run.label}. ${run.step ?? 'Starting'}. This takes several minutes; you can leave this page.`}</Notice>
    );
  }
  if (run.status === 'failed') {
    return <Notice tone="problem">{`It did not finish: ${run.message}`}</Notice>;
  }
  return null;
}

interface TeardownProps {
  readonly videoId: string;
  readonly breakdown: VideoBreakdownView | null;
  readonly parts: ViewParts;
}

/**
 * The Teardown tab: the video taken apart section by section, with its
 * downloads, or the one button that takes it apart.
 */
export function TeardownTab({ videoId, breakdown, parts }: TeardownProps) {
  const video = parts.work.videoBreakdown;
  const { asking, analysis } = parts.work;
  const runs = useRunsLine(videoId);
  const busy = video.run.status === 'running' || video.run.status === 'sending';
  const link = watchUrl(videoId);
  const start = (fresh: boolean): void => {
    if (link) video.fromLink(link, analysis.choice, fresh);
  };
  const blocked = asking && !busy ? 'Waits for the AI run under way to finish.' : null;
  return (
    <div className="flex min-w-0 flex-col gap-4 sm:gap-6">
      <RunStatus video={video} />
      {breakdown === null ? (
        <EmptyState
          icon={Film}
          title="Not taken apart yet"
          line={
            blocked ??
            runs ??
            'Jgtube measures the file in code, then an AI reads it. It takes several minutes.'
          }
          action={
            <Button onClick={() => start(false)} disabled={asking || busy}>
              {busy ? 'Working…' : 'Break this video down'}
            </Button>
          }
        />
      ) : (
        <>
          <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
            <p className="min-w-0 flex-1 basis-56 text-body-sm text-muted">
              {breakdown.source === 'file' ? 'A file you gave' : 'YouTube video'} · taken apart{' '}
              {writtenText(breakdown.writtenAt)}
              {blocked ? ` · ${blocked}` : ''}
            </p>
            {breakdown.teardown && <TeardownDownloads videoId={videoId} />}
            {breakdown.source === 'youtube' && (
              <Button small onClick={() => start(true)} disabled={asking || busy}>
                {busy ? 'Working…' : 'Break it down again'}
              </Button>
            )}
          </div>
          <TeardownResult key={`${breakdown.videoId}${breakdown.writtenAt}`} view={breakdown} />
        </>
      )}
    </div>
  );
}

interface ReviewProps {
  readonly videoId: string;
  readonly parts: ViewParts;
}

/**
 * The Thumbnail tab: this video's thumbnail set against the winners closest
 * to it on the owner's map, what they share counted, and the AI's review.
 */
export function ThumbnailTab({ videoId, parts }: ReviewProps) {
  const { analysis, asking } = parts.work;
  const centerId = parts.page.snapshot?.center.id ?? null;
  const review = useThumbnailReview(centerId, analysis.choice, analysis.engines);
  const { choose, picked } = review;
  useEffect(() => {
    if (picked !== videoId) choose(videoId);
  }, [choose, picked, videoId]);
  if (centerId === null) {
    return (
      <EmptyState
        icon={ScanSearch}
        title="A thumbnail review needs your channel first"
        line="It compares the thumbnail with the winners on your map."
        action={<Button href={viewHref('home')}>Go to Today</Button>}
      />
    );
  }
  const running = review.work.status === 'running';
  const ours = picked === videoId ? review.view : null;
  return (
    <div className="flex min-w-0 flex-col gap-4 sm:gap-6">
      <Card
        title="Thumbnail check"
        aside={
          <Button
            small
            icon={ScanSearch}
            onClick={review.ask}
            disabled={asking || running || picked !== videoId}
          >
            {running ? 'Working…' : ours ? 'Review it again' : 'Review this thumbnail'}
          </Button>
        }
      >
        <p className="text-body-md text-muted">
          Its thumbnail is set against the winners closest to it, what they share is counted, and
          the AI says how to improve it and writes a full prompt for it.
        </p>
        {asking && !running && (
          <p className="mt-2 text-body-sm text-dim">Waits for the AI run under way to finish.</p>
        )}
        {review.note && <p className="mt-2 text-body-sm text-dim">{review.note}</p>}
      </Card>
      {running && <Notice tone="working">{review.work.text}</Notice>}
      {review.work.status === 'failed' && <Notice tone="problem">{review.work.text}</Notice>}
      {review.problem && <Notice tone="problem">{review.problem}</Notice>}
      {ours && <ThumbnailReviewResult view={ours} />}
    </div>
  );
}

interface HookProps extends ReviewProps {
  readonly breakdown: VideoBreakdownView | null;
}

/**
 * The Hook and script tab: the first minute of what the video says, from
 * the hook library of the owner's map, and, once the video has been taken
 * apart, its opening frame by frame.
 */
export function HookTab({ videoId, breakdown, parts }: HookProps) {
  const { lab } = parts.work;
  const hook = lab.library?.hooks.find((one) => one.videoId === videoId) ?? null;
  const teardown = breakdown?.teardown ?? null;
  return (
    <div className="flex min-w-0 flex-col gap-4 sm:gap-6">
      {hook ? (
        <div className="max-w-3xl">
          <HookCard
            hook={hook}
            seconds={lab.library?.seconds ?? 60}
            center={lab.library?.centerChannelId ?? null}
            picked={lab.picks.some((pick) => pick.videoId === videoId)}
            onUse={() =>
              lab.pick({
                videoId,
                title: hook.title,
                channelTitle: hook.channelTitle,
                modelOpening: true,
                from: 'hook',
              })
            }
          />
        </div>
      ) : (
        <EmptyState
          icon={Captions}
          title="Its first minute has not been read"
          line="The hook library reads the openings of the strongest breakouts on your map."
          action={<Button href={viewHref('hooks')}>Open the hook library</Button>}
        />
      )}
      {teardown && <HookSection view={teardown} videoId={videoId} />}
      {!teardown && hook && (
        <p className="text-body-sm text-dim">
          Break the video down to see its opening frame by frame.
        </p>
      )}
    </div>
  );
}
