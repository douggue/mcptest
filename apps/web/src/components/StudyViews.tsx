import type { ViewId } from '../lib/routes';
import { AskClaude } from './AskClaude';
import { CommentMining } from './CommentMining';
import { LengthPacing } from './LengthPacing';
import { OwnVideos } from './OwnVideos';
import { UploadCalendar } from './UploadCalendar';
import { withMap, type ViewDraw, type ViewParts } from './viewParts';

const reloadOf = ({ work }: ViewParts): string => work.refresh.run.status;

/** The views of the rail's Study group, each drawn on its own. */
export const STUDY_VIEWS: Partial<Record<ViewId, ViewDraw>> = {
  ask: withMap('ask', (snapshot, { ask }) => (
    <AskClaude session={ask} centerTitle={snapshot.center.title} />
  )),
  // Each of these is about the owner's own channel: with none yet, the screen says so.
  'own-videos': withMap('own-videos', (snapshot, parts) => (
    <OwnVideos channelId={snapshot.center.id} reloadKey={reloadOf(parts)} />
  )),
  calendar: withMap('calendar', (snapshot, parts) => (
    <UploadCalendar channelId={snapshot.center.id} reloadKey={reloadOf(parts)} />
  )),
  pacing: withMap('pacing', (snapshot, parts) => (
    <LengthPacing channelId={snapshot.center.id} reloadKey={reloadOf(parts)} />
  )),
  comments: withMap('comments', (snapshot, parts) => (
    <CommentMining channelId={snapshot.center.id} reloadKey={reloadOf(parts)} />
  )),
};
