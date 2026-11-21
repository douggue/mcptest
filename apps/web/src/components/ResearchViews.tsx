import type { ViewId } from '../lib/routes';
import { BreakoutFeed } from './BreakoutFeed';
import { ChangesSection } from './ChangesSection';
import { ViewPage } from './layout/SplitView';
import { Niches } from './Niches';
import { RadarArea } from './RadarArea';
import { RefreshBar } from './RefreshBar';
import { SameTopic } from './SameTopic';
import { ThumbnailBoard } from './ThumbnailBoard';
import { Transfers } from './Transfers';
import { withMap, type ViewDraw, type ViewParts } from './viewParts';

/** Breaking out: the feed of videos taking off, each one press from the ideas. */
function Breakouts({ page, work }: ViewParts) {
  const { visible } = page;
  const { lab } = work;
  if (!visible) return null;
  return (
    <ViewPage id="breakouts" labelledBy="breakouts-title">
      <BreakoutFeed
        items={visible.breakouts}
        centerTitle={visible.center.title}
        pickedIds={lab.picks.map((pick) => pick.videoId)}
        onPick={(item) =>
          lab.pick({
            videoId: item.videoId,
            title: item.title,
            channelTitle: item.channelTitle,
            modelOpening: false,
            from: 'breakout',
          })
        }
      />
    </ViewPage>
  );
}

/** The views of the rail's Research group, each drawn on its own. */
export const RESEARCH_VIEWS: Partial<Record<ViewId, ViewDraw>> = {
  radar: ({ page, openChannel }) => <RadarArea page={page} onOpenChannel={openChannel} />,
  'what-changed': ({ page, work }) => (
    <ViewPage labelledBy="what-changed-title">
      <ChangesSection
        snapshot={page.snapshot}
        reloadKey={work.refresh.run.status}
        onAlertsChanged={work.alertCounts.reload}
        toolbar={<RefreshBar refresh={work.refresh} />}
      />
    </ViewPage>
  ),
  breakouts: withMap('breakouts', (_snapshot, parts) => <Breakouts {...parts} />),
  'same-topic': withMap('same-topic', (snapshot, { work, page }) => (
    <SameTopic
      state={work.sameTopic}
      centerTitle={snapshot.center.title}
      onSetStatus={page.setStatus}
    />
  )),
  thumbnails: withMap('thumbnails', (snapshot, { work, api }) => (
    <ThumbnailBoard
      state={work.board}
      centerTitle={snapshot.center.title}
      modelId={snapshot.model?.id ?? null}
      onDownload={(channelId) => api.downloadThumbnails(channelId)}
      onDownloadTranscripts={(channelId) => api.downloadTranscripts(channelId)}
    />
  )),
  transfers: ({ page, work, path }) => (
    <Transfers
      transfers={work.transfers}
      hasMap={page.snapshot !== null}
      onMakeConcepts={page.snapshot ? path.conceptsFrom : undefined}
    />
  ),
  niches: ({ page, work, path }) => (
    <Niches
      niches={work.niches}
      hasMap={page.snapshot !== null}
      onBreakDown={page.snapshot && !work.asking ? path.breakDown : undefined}
    />
  ),
};
