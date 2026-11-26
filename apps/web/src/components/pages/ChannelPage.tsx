import type { ChannelProfile } from '@jgtube/core';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { useEffect } from 'react';
import type { BoardMode } from '../../lib/board';
import { channelTabs, onMapOf, pageVideos, relationWords, type OnMap } from '../../lib/channelPage';
import { readLine } from '../../lib/channelView';
import { channelUrl } from '../../lib/format';
import { channelHref, viewHref, type ChannelTab } from '../../lib/routes';
import { BreakdownChannelTab } from '../BreakdownChannelTab';
import { MoneyBadge } from '../MoneyBadge';
import { ChannelCard } from '../ThumbnailChannel';
import { Badge, Level } from '../ui/Badge';
import { Card } from '../ui/Card';
import { Avatar } from '../ui/Row';
import { EmptyState, ErrorState, Skeleton } from '../ui/States';
import { Tabs } from '../ui/Tabs';
import { useChannelProfile } from '../useChannelProfile';
import type { ViewParts } from '../viewParts';
import { ChannelOverview } from './ChannelOverview';
import { ChannelVideos } from './ChannelVideos';
import { ChannelActions, VideoGrid } from './ChannelParts';

/** Winners beside ordinary ones: the way a channel's thumbnails are laid out here. */
const COMPARE: BoardMode = 'compare';

/** Back to where the owner came from, or to the channels of Discover. */
function Crumb() {
  return (
    <a
      href={viewHref('competitors')}
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
  readonly profile: ChannelProfile;
  readonly parts: ViewParts;
  readonly own: boolean;
  readonly onMap: OnMap | null;
  /** The Breakdown tab is open. */
  readonly onBreakdown: boolean;
}

/** Under the name: its handle, how it relates to the owner's channel, when it was read. */
function Line({ profile, onMap }: Pick<HeadProps, 'profile' | 'onMap'>) {
  const link = channelUrl(profile.id);
  return (
    <p className="flex min-w-0 flex-wrap items-center gap-x-2 text-body-md text-muted">
      {profile.handle && <span>@{profile.handle}</span>}
      {onMap && (
        <span>
          · {relationWords(onMap)}{' '}
          <a href={channelHref(onMap.center.id)} className="font-medium text-link hover:underline">
            {onMap.center.title}
          </a>
        </span>
      )}
      <span className="text-body-sm text-dim">· {readLine(profile, new Date())}</span>
      {link && (
        <a
          href={link}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-body-sm font-medium text-link hover:underline"
        >
          YouTube
          <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" />
        </a>
      )}
    </p>
  );
}

/** The top of a channel's page: logo, name, what it is to the owner, and what can be done with it. */
function Head({ profile, parts, own, onMap, onBreakdown }: HeadProps) {
  return (
    <header className="flex min-w-0 flex-wrap items-center gap-4 sm:gap-6">
      <Avatar title={profile.title} logoUrl={profile.logoUrl} size="xl" />
      <div className="min-w-0 flex-1 basis-64">
        <h1 className="break-words text-[30px] font-[650] leading-9 tracking-tight text-ink sm:text-display">
          {profile.title}
        </h1>
        <Line profile={profile} onMap={onMap} />
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          {onMap && <Level level={onMap.closeness} />}
          <MoneyBadge channelId={profile.id} />
          {onMap?.competitor && <Badge>Like yours</Badge>}
          {own && <Badge tone="proven">Your channel</Badge>}
        </div>
      </div>
      <ChannelActions profile={profile} parts={parts} own={own} onBreakdown={onBreakdown} />
    </header>
  );
}

/** The channel's thumbnails: its winners beside its ordinary ones, when it is on the owner's map. */
function Thumbnails({
  profile,
  parts,
}: {
  readonly profile: ChannelProfile;
  readonly parts: ViewParts;
}) {
  const { work, api, page } = parts;
  const board = work.board.status === 'ready' ? work.board.board : null;
  const onBoard = board?.channels.find((channel) => channel.id === profile.id);
  if (board && onBoard) {
    return (
      <ChannelCard
        channel={onBoard}
        board={board}
        mode={COMPARE}
        isModel={page.snapshot?.model?.id === profile.id}
        onDownload={(channelId) => api.downloadThumbnails(channelId)}
        onDownloadTranscripts={(channelId) => api.downloadTranscripts(channelId)}
      />
    );
  }
  const { outliers, newest } = pageVideos(profile);
  if (outliers.length + newest.length === 0) {
    return <EmptyState title="No videos of this channel are stored" />;
  }
  return (
    <div className="flex min-w-0 flex-col gap-4 sm:gap-6">
      <Card title="Its winners">
        <VideoGrid videos={outliers} empty="None of its stored videos stands out yet." />
      </Card>
      <Card title="Its ordinary ones">
        <VideoGrid videos={newest} empty="All its stored videos are among its winners." />
      </Card>
    </div>
  );
}

interface Props {
  readonly parts: ViewParts;
  readonly channelId: string;
  readonly tab: ChannelTab;
  /** The owner's own channel, under My channel: the place's tabs stand in for the page's own. */
  readonly own: boolean;
}

/**
 * One channel's page, the same for the owner's channel and for anyone
 * else's: its name and what it is to the owner, then its Overview, Videos,
 * Thumbnails and Breakdown as tabs.
 */
export function ChannelPage({ parts, channelId, tab, own }: Props) {
  const state = useChannelProfile(channelId, parts.work.refresh.run.status);
  const profile = state.status === 'ready' ? state.profile : null;
  const title = profile?.title ?? null;
  const { nameScreen } = parts;
  useEffect(() => {
    if (title) nameScreen(channelId, title);
  }, [nameScreen, channelId, title]);
  const onMap = own ? null : onMapOf(channelId, parts.page.snapshot);

  return (
    <section className="mx-auto flex w-full max-w-[1260px] min-w-0 flex-col gap-4 px-4 pb-space-xl pt-5 sm:gap-6 sm:px-8 sm:pt-7">
      {!own && <Crumb />}
      {state.status === 'loading' && (
        <div role="status" aria-label="Reading the channel" className="flex flex-col gap-3">
          <Skeleton className="h-10 w-1/2" />
          <Skeleton className="h-5 w-1/3" />
        </div>
      )}
      {state.status === 'missing' && (
        <EmptyState
          title="This channel is not stored yet"
          line="Paste its YouTube link in Search and Jgtube reads it, or it is read when a map reaches it."
        />
      )}
      {state.status === 'failed' && (
        <ErrorState title="The channel could not be read" line={state.message} />
      )}
      {profile && (
        <>
          <Head
            profile={profile}
            parts={parts}
            own={own}
            onMap={onMap}
            onBreakdown={tab === 'breakdown'}
          />
          {!own && (
            <Tabs
              label="Channel tabs"
              active={tab}
              items={channelTabs(channelId, profile.stored.videos)}
            />
          )}
          {tab === 'overview' && <ChannelOverview profile={profile} parts={parts} own={own} />}
          {tab === 'videos' && <ChannelVideos channelId={channelId} />}
          {tab === 'thumbnails' && <Thumbnails profile={profile} parts={parts} />}
          {tab === 'breakdown' && (
            <BreakdownChannelTab parts={parts} channelId={channelId} embedded />
          )}
        </>
      )}
    </section>
  );
}
