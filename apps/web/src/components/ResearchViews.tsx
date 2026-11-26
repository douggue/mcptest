import type { ViewId } from '../lib/routes';
import { ChangesSection } from './ChangesSection';
import { ViewPage } from './layout/SplitView';
import { Niches } from './Niches';
import { RadarArea } from './RadarArea';
import { RefreshBar } from './RefreshBar';
import { SameTopic } from './SameTopic';
import { ThumbnailBoard } from './ThumbnailBoard';
import { ThumbnailReview } from './ThumbnailReview';
import { withMap, type ViewDraw } from './viewParts';

/** The views of the rail's Research group, each drawn on its own. */
export const RESEARCH_VIEWS: Partial<Record<ViewId, ViewDraw>> = {
  radar: ({ page, openChannel }) => <RadarArea page={page} onOpenChannel={openChannel} />,
  'what-changed': withMap('what-changed', (snapshot, { work }) => (
    <ViewPage labelledBy="what-changed-title">
      <ChangesSection
        snapshot={snapshot}
        reloadKey={work.refresh.run.status}
        onAlertsChanged={work.alertCounts.reload}
        toolbar={<RefreshBar refresh={work.refresh} />}
      />
    </ViewPage>
  )),
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
      review={
        <ThumbnailReview
          channelId={snapshot.center.id}
          choice={work.analysis.choice}
          engines={work.analysis.engines}
          busy={work.asking}
        />
      }
      onDownload={(channelId) => api.downloadThumbnails(channelId)}
      onDownloadTranscripts={(channelId) => api.downloadTranscripts(channelId)}
    />
  )),
  niches: ({ page, work, path }) => (
    <Niches
      niches={work.niches}
      onBreakDown={page.snapshot && !work.asking ? path.breakDown : undefined}
    />
  ),
};
