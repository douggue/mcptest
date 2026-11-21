import type { ViewId } from '../lib/routes';
import { uploadVideoFile } from '../lib/upload';
import { AskClaude } from './AskClaude';
import { CommentMining } from './CommentMining';
import { LengthPacing } from './LengthPacing';
import { OwnVideos } from './OwnVideos';
import { UploadCalendar } from './UploadCalendar';
import { withMap, type ViewDraw, type ViewParts } from './viewParts';

const centerOf = ({ page }: ViewParts): string | null => page.snapshot?.center.id ?? null;
const reloadOf = ({ work }: ViewParts): string => work.refresh.run.status;

/** The views of the rail's Study group, each drawn on its own. */
export const STUDY_VIEWS: Partial<Record<ViewId, ViewDraw>> = {
  ask: withMap('ask', (snapshot, { work }) => (
    <AskClaude
      analysis={work.analysis}
      breakdown={work.breakdown}
      channels={work.breakdownChannels}
      onSendVideo={uploadVideoFile}
      centerId={snapshot.center.id}
      centerTitle={snapshot.center.title}
    />
  )),
  'own-videos': (parts) => <OwnVideos channelId={centerOf(parts)} reloadKey={reloadOf(parts)} />,
  calendar: (parts) => <UploadCalendar channelId={centerOf(parts)} reloadKey={reloadOf(parts)} />,
  pacing: (parts) => <LengthPacing channelId={centerOf(parts)} reloadKey={reloadOf(parts)} />,
  comments: (parts) => <CommentMining channelId={centerOf(parts)} reloadKey={reloadOf(parts)} />,
};
