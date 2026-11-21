import type { ChannelProfile } from '@jgtube/core';
import { channelActions, type ChannelAction } from '../lib/channelView';
import { ChannelCompetitors } from './ChannelCompetitors';
import { ChannelSummary } from './ChannelSummary';
import { ChannelVideos } from './ChannelVideos';
import { Inspector } from './Inspector';
import { ViewPage } from './layout/SplitView';
import { NOTE, QUIET_BUTTON } from './LabStatus';
import { useChannelProfile } from './useChannelProfile';
import { messageOf } from './useMapPage';
import type { ViewParts } from './viewParts';

/** The channel's one primary action: the next step in the app, not a re-run or an exit. */
const PRIMARY_ACTION =
  'flex min-h-11 items-center rounded bg-primary-container px-4 text-body-sm font-semibold text-on-primary transition-opacity hover:opacity-90';

interface ActionsProps extends ViewParts {
  readonly profile: ChannelProfile;
}

/** The buttons that take the channel into the other views. */
function Actions({ profile, page, work, path, go }: ActionsProps) {
  const run = (action: ChannelAction): void => {
    if (action.id === 'breakdown') {
      path.breakDown({ id: profile.id, title: profile.title });
      return;
    }
    if (action.id === 'make-map') page.setQuery(profile.handle ? `@${profile.handle}` : profile.id);
    // A feature of the channel's own map needs that map on screen first.
    const saved = page.saved.find((channel) => channel.id === profile.id);
    if (action.needsMap && saved && page.snapshot?.center.id !== profile.id) page.open(saved);
    go(action.route);
  };
  // On the map's own channel the tabs above open its other views, so only the ways forward stay.
  const isCenter = page.snapshot?.center.id === profile.id;
  const actions = channelActions(profile.hasMap).filter(
    (action) => !isCenter || action.id === 'ideas' || action.id === 'breakdown',
  );
  return (
    <div className="flex flex-wrap items-center gap-2">
      {actions.map((action) => (
        <button
          key={action.id}
          type="button"
          disabled={action.id === 'breakdown' && work.asking}
          onClick={() => run(action)}
          className={action.id === 'ideas' ? PRIMARY_ACTION : QUIET_BUTTON}
        >
          {action.label}
        </button>
      ))}
      {work.asking && (
        <span className="text-body-sm text-outline">
          Break it down waits for the AI run under way.
        </span>
      )}
    </div>
  );
}

/** How the channel sits on the map on screen, with the owner's say on it, when it is on that map. */
function OnTheMap({ profile, page, work }: ActionsProps) {
  const onMap = page.snapshot?.channels.find((channel) => channel.id === profile.id);
  if (!onMap || !page.snapshot) return null;
  return (
    <section className="flex min-w-0 flex-col gap-space-sm">
      <h3 className="text-label text-outline">On the map of {page.snapshot.center.title}</h3>
      <div>
        <Inspector
          inline
          channel={onMap}
          busy={work.asking}
          onSetStatus={(status) => {
            page
              .setStatus(onMap.id, status)
              .catch((error: unknown) => page.setMessage(messageOf(error)));
          }}
        />
      </div>
    </section>
  );
}

/** The column beside the videos: the competitors of a centre, or the channel's place on the map. */
function Beside(props: ActionsProps) {
  const { profile, page } = props;
  const { snapshot } = page;
  if (snapshot?.center.id === profile.id) {
    return <ChannelCompetitors snapshot={snapshot} page={page} />;
  }
  return <OnTheMap {...props} />;
}

function Profile(props: ActionsProps) {
  const { profile, page } = props;
  const { outliers } = profile;
  // The newest videos that are already among its outliers are shown once, there.
  const inTop = new Set(profile.top.map((video) => video.videoId));
  const newest = profile.recent.filter((video) => !inTop.has(video.videoId));
  const beside =
    page.snapshot?.center.id === profile.id ||
    page.snapshot?.channels.some((channel) => channel.id === profile.id);
  return (
    <div className="flex min-w-0 flex-col gap-space-lg">
      <ChannelSummary profile={profile} withBack />
      <Actions {...props} />
      <div
        className={`grid min-w-0 grid-cols-1 items-start gap-space-lg ${beside ? 'xl:grid-cols-[minmax(0,1fr)_380px]' : ''}`}
      >
        <div className="flex min-w-0 flex-col gap-space-xl">
          <ChannelVideos
            title="Its outliers"
            lead={`${outliers.minScore}× or more of its usual views at the same age.`}
            videos={profile.top}
            empty="None of its stored videos stands out from its usual views yet."
          />
          <ChannelVideos
            title="Its newest videos"
            lead="Newest first, leaving out the outliers above."
            videos={newest}
            empty={
              profile.recent.length === 0
                ? 'No videos of this channel are stored.'
                : 'Its newest stored videos are all among its outliers above.'
            }
          />
        </div>
        {beside && <Beside {...props} />}
      </div>
    </div>
  );
}

/**
 * One channel's own view: its logo and stored numbers, some of its videos,
 * the buttons into the other views for it, and, when it is on the map on
 * screen, how it sits there.
 */
export function ChannelView(parts: ViewParts & { readonly channelId: string }) {
  const { channelId, ...rest } = parts;
  const state = useChannelProfile(channelId, rest.work.refresh.run.status);
  return (
    <ViewPage>
      <div className="flex min-w-0 flex-col gap-space-lg">
        {state.status === 'loading' && (
          <p role="status" className={NOTE}>
            Reading the channel from the store.
          </p>
        )}
        {state.status === 'missing' && (
          <p role="alert" className={NOTE}>
            This channel is not stored yet. It is read when a map reaches it.
          </p>
        )}
        {state.status === 'failed' && (
          <p role="alert" className={`${NOTE} text-error`}>
            {state.message}
          </p>
        )}
        {state.status === 'ready' && <Profile {...rest} profile={state.profile} />}
      </div>
    </ViewPage>
  );
}
