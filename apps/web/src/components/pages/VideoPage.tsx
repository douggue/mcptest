import { ArrowLeft, Check, ExternalLink, Plus } from 'lucide-react';
import { useEffect } from 'react';
import type { BankVideoLook } from '../../lib/bank';
import { watchUrl } from '../../lib/format';
import { channelHref, viewHref, type VideoTab } from '../../lib/routes';
import { scoreLine, videoTabs, viewsLine } from '../../lib/videoPage';
import type { VideoBreakdownView } from '../../lib/videoBreakdown';
import { AddToFormat } from '../AddToFormat';
import { BankSave } from '../BankSave';
import { ScoreBadge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { ChannelChip } from '../ui/Chip';
import { ErrorState, Skeleton } from '../ui/States';
import { Tabs } from '../ui/Tabs';
import { VideoThumb } from '../ui/VideoCard';
import type { ViewParts } from '../viewParts';
import { useBankVideo, type BankVideoModel } from './useBankVideo';
import { VideoSummary } from './VideoSummary';
import { HookTab, TeardownTab, ThumbnailTab } from './VideoTabs';

/** Back to where the owner came from, or to the videos of Discover. */
function Crumb() {
  return (
    <a
      href={viewHref('breakouts')}
      onClick={(event) => {
        if (window.history.length < 2) return;
        event.preventDefault();
        window.history.back();
      }}
      className="inline-flex w-fit items-center gap-2 rounded text-body-sm text-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
    >
      <ArrowLeft aria-hidden="true" className="h-4 w-4" />
      Back
    </a>
  );
}

interface HeadProps {
  readonly videoId: string;
  readonly title: string;
  readonly look: BankVideoLook | null;
  readonly model: BankVideoModel;
  readonly parts: ViewParts;
}

/** The three actions every video carries, and the way out to YouTube. */
function Actions({ videoId, title, look, model, parts }: HeadProps) {
  const { lab } = parts.work;
  const picked = lab.picks.some((pick) => pick.videoId === videoId);
  const link = watchUrl(videoId);
  if (!look) return null;
  const { video } = look;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2.5">
      <Button
        kind={picked ? 'second' : 'main'}
        icon={picked ? Check : Plus}
        onClick={() =>
          lab.pick({
            videoId,
            title,
            channelTitle: video.channel.title,
            modelOpening: false,
            from: 'breakout',
          })
        }
      >
        {picked ? 'In ideas' : 'Add to ideas'}
      </Button>
      <AddToFormat large source={{ kind: 'video', use: 'video', videoId, center: null }} />
      <BankSave
        videoId={videoId}
        collections={look.collections}
        inCollections={look.saved}
        onChanged={model.setSaved}
      />
      {link && (
        <a
          href={link}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-11 items-center gap-1.5 rounded px-1.5 text-[15px] font-semibold text-link hover:underline"
        >
          YouTube
          <ExternalLink aria-hidden="true" className="h-4 w-4" />
        </a>
      )}
    </div>
  );
}

/** The top of a video's page: its thumbnail, its title, its score and channel, and its actions. */
function Head(props: HeadProps) {
  const { videoId, title, look } = props;
  const video = look?.video ?? null;
  const score = video ? scoreLine(video) : null;
  return (
    <header className="grid min-w-0 grid-cols-1 items-center gap-4 md:grid-cols-[minmax(0,440px)_minmax(0,1fr)] md:gap-7">
      <VideoThumb videoId={videoId} durationSeconds={video?.durationSeconds ?? null} />
      <div className="min-w-0">
        <h1 className="break-words text-2xl font-[650] leading-[30px] tracking-tight text-ink md:text-headline-lg">
          {title}
        </h1>
        {video && (
          <div className="mb-[18px] mt-3.5 flex min-w-0 flex-wrap items-center gap-2.5 text-body-md text-muted">
            {score && <ScoreBadge>{score}</ScoreBadge>}
            <ChannelChip
              title={video.channel.title}
              logoUrl={video.channel.logoUrl}
              href={channelHref(video.channel.id)}
            />
            <span>{viewsLine(video)}</span>
          </div>
        )}
        <Actions {...props} />
      </div>
    </header>
  );
}

interface Props {
  readonly parts: ViewParts;
  readonly videoId: string;
  readonly tab: VideoTab;
}

/** The kept breakdown of this video, read when the page opens on it. */
function useBreakdownOf(parts: ViewParts, videoId: string): VideoBreakdownView | null {
  const video = parts.work.videoBreakdown;
  const { open, openVideo } = video;
  const openId = open?.videoId ?? null;
  useEffect(() => {
    if (openId !== videoId) openVideo(videoId);
  }, [openId, openVideo, videoId]);
  return open?.videoId === videoId ? open : null;
}

/**
 * One video's page, the same wherever it is opened from: what is stored
 * about it, then its Summary, its full Teardown, its Thumbnail review and
 * its Hook and script as tabs.
 */
export function VideoPage({ parts, videoId, tab }: Props) {
  const model = useBankVideo(videoId, parts.work.refresh.run.status);
  const breakdown = useBreakdownOf(parts, videoId);
  const { state } = model;
  const look = state.status === 'ready' ? state.found : null;
  const title = look?.video.title ?? breakdown?.title ?? null;
  const { nameScreen } = parts;
  useEffect(() => {
    if (title) nameScreen(videoId, title);
  }, [nameScreen, videoId, title]);

  return (
    <section className="mx-auto flex w-full max-w-[1260px] min-w-0 flex-col gap-4 px-4 pb-space-xl pt-5 sm:gap-6 sm:px-8 sm:pt-7">
      <Crumb />
      {state.status === 'loading' && title === null && (
        <div role="status" aria-label="Reading the video" className="flex flex-col gap-3">
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-5 w-1/3" />
        </div>
      )}
      {state.status === 'failed' && (
        <ErrorState title="The video could not be read" line={state.message} />
      )}
      {state.status !== 'failed' && (state.status === 'ready' || title !== null) && (
        <>
          <Head
            videoId={videoId}
            title={title ?? 'A video Jgtube has not stored yet'}
            look={look}
            model={model}
            parts={parts}
          />
          {state.status === 'ready' && look === null && breakdown === null && (
            <p className="text-body-md text-muted">
              Nothing is stored about this video yet. Break it down to read and measure it.
            </p>
          )}
          <Tabs label="Video tabs" active={tab} items={videoTabs(videoId)} />
          {tab === 'summary' && (
            <VideoSummary videoId={videoId} video={look?.video ?? null} breakdown={breakdown} />
          )}
          {tab === 'teardown' && (
            <TeardownTab videoId={videoId} breakdown={breakdown} parts={parts} />
          )}
          {tab === 'thumbnail' && <ThumbnailTab videoId={videoId} parts={parts} />}
          {tab === 'hook' && <HookTab videoId={videoId} breakdown={breakdown} parts={parts} />}
        </>
      )}
    </section>
  );
}
