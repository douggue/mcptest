import { useCallback, useMemo } from 'react';
import { ConnectionsContext } from './components/Connections';
import { Shell } from './components/Shell';
import { ViewHost } from './components/ViewHost';
import { useMapPage } from './components/useMapPage';
import { usePagePath } from './components/usePagePath';
import { useRoute } from './components/useRoute';
import { useWorkspace } from './components/useWorkspace';
import { aiBadge } from './lib/aiBadge';
import { createApi } from './lib/api';

/**
 * The app: one view at a time, named in the address. The rail opens the
 * overview and the views of its Research, Create and Study groups; a channel
 * anywhere opens its own view; Settings opens from the top bar, beside the
 * word on which AI answers. The map, the workspace and the links between
 * views live here, so they last while the owner moves between views.
 */
export function App() {
  const api = useMemo(() => createApi(), []);
  const { route, go } = useRoute();
  const page = useMapPage(api);
  const work = useWorkspace(api, page.snapshot, page.saved);
  const path = usePagePath(page.snapshot, work, go);
  const openChannel = useCallback(
    (channelId: string) => go({ view: 'channel', channelId, anchor: null }),
    [go],
  );
  const { analysis } = work;
  const ai = {
    choice: analysis.choice,
    engines: analysis.engines,
    busy: work.asking,
    choose: analysis.choose,
  };

  return (
    <ConnectionsContext.Provider value={page.snapshot ? path.connections : null}>
      <Shell active={route.view} ai={aiBadge(analysis.choice, analysis.engines)}>
        <ViewHost route={route} parts={{ api, page, work, path, go, openChannel }} ai={ai} />
      </Shell>
    </ConnectionsContext.Provider>
  );
}
