import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { useWanted } from './components/useWanted';
import { useWorkspace } from './components/useWorkspace';
import { partsFor } from './lib/dataParts';
import { aiOf } from './components/viewParts';
import { createApi } from './lib/api';
import { askContext } from './lib/askContext';
import {
  noteScreen,
  pageTitle,
  settled,
  whereIs,
  type LastScreens,
  type PageName,
} from './lib/places';
import { routeHash } from './lib/routes';

/**
 * The app: one screen at a time, named in the address. The rail opens the
 * five places; a channel anywhere opens its own page; search, the work under
 * way, Ask and Settings sit in the top bar on every screen. The map, the
 * workspace, the conversation with the AI and the links between screens
 * live here, so they last while the owner moves about.
 */
export function App() {
  const api = useMemo(() => createApi(), []);
  const { route, go, notFound } = useRoute();
  const page = useMapPage(api);
  const [asking, setAsking] = useState(false);
  const centerId = page.snapshot?.center.id ?? null;
  // A tab of the owner's own channel page, reached by its channel id, is a screen of My channel.
  const shown = useMemo(() => settled(route, centerId), [route, centerId]);
  // Each slow read waits for the first screen that shows it.
  const parts = useWanted(partsFor(shown, asking));
  const work = useWorkspace(api, page.snapshot, page.saved, { parts, mapKnown: page.mapKnown });
  const path = usePagePath(page.snapshot, work, go, parts.has('flow'));
  const openChannel = useCallback(
    (channelId: string) => go({ view: 'channel', channelId, anchor: null }),
    [go],
  );
  const openVideo = useCallback(
    (videoId: string) => go({ view: 'video', channelId: null, anchor: null, videoId }),
    [go],
  );
  const { snapshot } = page;
  const { analysis, breakdown } = work;
  const ask = useAskSession(analysis, {
    centerId,
    otherRun: work.asking && analysis.state.status !== 'running',
    breakingDown: breakdown.state.status === 'running' ? breakdown.state.channel.title : null,
    wanted: parts.has('answers'),
  });
  const searchable = useMemo(
    () => [...page.saved, ...(snapshot?.channels ?? [])],
    [page.saved, snapshot],
  );
  const closeAsk = useCallback(() => setAsking(false), []);
  // What Ask is about is the screen it was opened over: opened large, the last screen before it.
  const lastScreen = useRef(shown);
  if (shown.view !== 'ask') lastScreen.current = shown;
  const context = askContext(lastScreen.current, snapshot);
  const openLarge = useCallback(() => {
    setAsking(false);
    go({ view: 'ask', channelId: null, anchor: null });
  }, [go]);
  /** Back from the large view to the screen it was opened over, with the panel open. */
  const shrinkAsk = useCallback(() => {
    setAsking(true);
    if (window.history.length > 1) window.history.back();
    else go(lastScreen.current);
  }, [go]);

  // Each place is picked up where it was left: the menu leads back to its last screen.
  const [last, setLast] = useState<LastScreens>({});
  useEffect(() => {
    setLast((now) => noteScreen(now, shown, centerId, routeHash(shown)));
  }, [shown, centerId]);
  const [named, setNamed] = useState<PageName | null>(null);
  const nameScreen = useCallback((id: string, name: string) => setNamed({ id, name }), []);
  useEffect(() => {
    document.title = pageTitle(shown, centerId, named);
  }, [shown, centerId, named]);
  // Ask opened large is the same conversation on a page of its own: the panel steps aside.
  const panelOpen = asking && shown.view !== 'ask';

  return (
    <ConnectionsContext.Provider value={snapshot ? path.connections : null}>
      <Shell
        active={shown.view}
        place={whereIs(shown, centerId)?.place.id ?? null}
        last={last}
        asking={panelOpen}
        onAsk={() => (shown.view === 'ask' ? shrinkAsk() : setAsking(true))}
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
          notFound={notFound}
          route={shown}
          parts={{
            api,
            page,
            work,
            path,
            go,
            openChannel,
            ask,
            nameScreen,
            askLarge: { context, shrink: shrinkAsk },
          }}
          ai={aiOf(work)}
        />
      </Shell>
      {panelOpen && (
        <AskPanel session={ask} context={context} onClose={closeAsk} onLarge={openLarge} />
      )}
    </ConnectionsContext.Provider>
  );
}
