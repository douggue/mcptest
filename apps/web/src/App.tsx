import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChannelSwitcher } from './components/ChannelSwitcher';
import { ConnectionsContext } from './components/Connections';
import { Shell } from './components/Shell';
import { AskPanel } from './components/shell/AskPanel';
import { SearchBox } from './components/shell/SearchBox';
import { ViewHost } from './components/ViewHost';
import { useAskSession } from './components/useAskSession';
import { useMapPage } from './components/useMapPage';
import { usePagePath } from './components/usePagePath';
import { useRoute } from './components/useRoute';
import { useWorkspace } from './components/useWorkspace';
import { aiOf } from './components/viewParts';
import { createApi } from './lib/api';
import { askContext } from './lib/askContext';
import { pageTitle, whereIs } from './lib/places';
import { handVideo } from './lib/videoHandoff';

/**
 * The app: one screen at a time, named in the address. The rail opens the
 * five places; a channel anywhere opens its own page; search, the work under
 * way, Ask and Settings sit in the top bar on every screen. The map, the
 * workspace, the conversation with the AI and the links between screens
 * live here, so they last while the owner moves about.
 */
export function App() {
  const api = useMemo(() => createApi(), []);
  const { route, go } = useRoute();
  const page = useMapPage(api);
  const work = useWorkspace(api, page.snapshot, page.saved);
  const path = usePagePath(page.snapshot, work, go);
  const [asking, setAsking] = useState(false);
  const openChannel = useCallback(
    (channelId: string) => go({ view: 'channel', channelId, anchor: null }),
    [go],
  );
  const openVideo = useCallback(
    (videoId: string) => {
      // The video is studied in the one-video screen, which fills its link with it.
      handVideo(videoId);
      go({ view: 'video-breakdown', channelId: null, anchor: null });
    },
    [go],
  );
  const { snapshot } = page;
  const centerId = snapshot?.center.id ?? null;
  const { analysis, breakdown } = work;
  const ask = useAskSession(analysis, {
    centerId,
    otherRun: work.asking && analysis.state.status !== 'running',
    breakingDown: breakdown.state.status === 'running' ? breakdown.state.channel.title : null,
  });
  const searchable = useMemo(
    () => [...page.saved, ...(snapshot?.channels ?? [])],
    [page.saved, snapshot],
  );
  const closeAsk = useCallback(() => setAsking(false), []);

  useEffect(() => {
    document.title = pageTitle(route, centerId);
  }, [route, centerId]);
  // Ask opened large is the same conversation on a page of its own: the panel steps aside.
  const panelOpen = asking && route.view !== 'ask';

  return (
    <ConnectionsContext.Provider value={snapshot ? path.connections : null}>
      <Shell
        active={route.view}
        place={whereIs(route, centerId)?.place.id ?? null}
        asking={panelOpen}
        onAsk={() => setAsking(route.view !== 'ask')}
        search={
          <SearchBox channels={searchable} onOpenChannel={openChannel} onOpenVideo={openVideo} />
        }
        switcher={
          <ChannelSwitcher
            channels={page.saved}
            currentId={centerId}
            busy={page.job?.status === 'running'}
            onOpen={(channel) => {
              page.open(channel);
              openChannel(channel.id);
            }}
          />
        }
      >
        <ViewHost
          route={route}
          parts={{ api, page, work, path, go, openChannel, ask }}
          ai={aiOf(work)}
        />
      </Shell>
      {panelOpen && (
        <AskPanel session={ask} context={askContext(route, snapshot)} onClose={closeAsk} />
      )}
    </ConnectionsContext.Provider>
  );
}
