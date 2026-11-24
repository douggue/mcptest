import type { ChannelProfile, ProfileVideo } from '@jgtube/core';
import { useState } from 'react';
import { profileScore, profileVideoMeta } from '../../lib/channelPage';
import { channelActions, type ChannelAction } from '../../lib/channelView';
import { outlierPicks } from '../../lib/ideaLab';
import { videoHref } from '../../lib/routes';
import { ShowMore } from '../layout/Notice';
import { Button } from '../ui/Button';
import { VideoCard } from '../ui/VideoCard';
import { downloadMap } from '../useMapPage';
import type { ViewParts } from '../viewParts';

/** How many videos a list shows before "Show more". */
const FIRST_SHOWN = 6;

interface GridProps {
  readonly videos: readonly ProfileVideo[];
  /** Said when the list is empty. */
  readonly empty: string;
  /** How many to show at first; all of them when left out. */
  readonly first?: number;
  readonly columns?: 2 | 3;
}

/** A channel's videos as cards; each opens the video's own page. */
export function VideoGrid({ videos, empty, first = FIRST_SHOWN, columns = 3 }: GridProps) {
  const [shown, setShown] = useState(first);
  if (videos.length === 0) return <p className="text-body-md text-muted">{empty}</p>;
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <ul
        className={`grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6 ${columns === 3 ? 'lg:grid-cols-3' : ''}`}
      >
        {videos.slice(0, shown).map((video) => (
          <li key={video.videoId} className="min-w-0">
            <VideoCard
              videoId={video.videoId}
              href={videoHref(video.videoId)}
              title={video.title}
              score={profileScore(video)}
              durationSeconds={video.durationSeconds}
              meta={profileVideoMeta(video)}
            />
          </li>
        ))}
      </ul>
      {videos.length > shown && (
        <ShowMore
          left={videos.length - shown}
          noun="videos"
          onClick={() => setShown(videos.length)}
        />
      )}
    </div>
  );
}

interface ActionsProps {
  readonly profile: ChannelProfile;
  readonly parts: ViewParts;
  /** The owner's own channel: ideas come first, and its map can be downloaded. */
  readonly own: boolean;
  /** The Breakdown tab is open: its own button starts the breakdown, so none is offered here. */
  readonly onBreakdown?: boolean;
}

/**
 * What can be done with a channel, at the right of its name: one main
 * action (a breakdown for anyone else's channel, ideas for the owner's own)
 * and the quieter ones beside it.
 */
export function ChannelActions({ profile, parts, own, onBreakdown }: ActionsProps) {
  const { page, work, path, go } = parts;
  const run = (action: ChannelAction): void => {
    if (action.id === 'breakdown') {
      path.breakDown({ id: profile.id, title: profile.title });
      return;
    }
    if (action.id === 'make-map') page.setQuery(profile.handle ? `@${profile.handle}` : profile.id);
    // Ideas for it arrives with the channel's strongest outliers picked, so Write is ready.
    if (action.id === 'ideas') {
      for (const pick of outlierPicks(profile.top, work.lab.picks, profile.title)) {
        work.lab.pick(pick);
      }
    }
    // A feature of the channel's own map needs that map on screen first.
    const saved = page.saved.find((channel) => channel.id === profile.id);
    if (action.needsMap && saved && page.snapshot?.center.id !== profile.id) page.open(saved);
    go(action.route);
  };
  // On the owner's own channel the tabs open its other screens, so only the ways forward stay.
  const actions = channelActions(profile.hasMap).filter(
    (action) =>
      (!own || action.id === 'ideas' || action.id === 'breakdown') &&
      !(onBreakdown && action.id === 'breakdown'),
  );
  const main = own ? 'ideas' : 'breakdown';
  const ordered = [...actions].sort((a, b) => Number(b.id === main) - Number(a.id === main));
  const { snapshot } = page;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2.5">
      {ordered.map((action) => (
        <Button
          key={action.id}
          kind={action.id === main ? 'main' : 'second'}
          onClick={() => run(action)}
        >
          {action.label}
        </Button>
      ))}
      {own && snapshot && <Button onClick={() => downloadMap(snapshot)}>Download this map</Button>}
    </div>
  );
}
