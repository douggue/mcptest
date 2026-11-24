import type { MapSnapshot } from '@jgtube/core';
import { Radar } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Api } from '../lib/api';
import type { AskContext } from '../lib/askContext';
import { VIEWS, viewHref, type ViewId } from '../lib/routes';
import type { AiChoice } from './AiEngines';
import type { PagePath } from './usePagePath';
import type { Go } from './useRoute';
import type { MapPage } from './useMapPage';
import type { AskSession } from './useAskSession';
import type { Workspace } from './useWorkspace';
import { Button } from './ui/Button';
import { EmptyState } from './ui/States';

/** Everything a view is drawn from: the map on screen, the workspace and the links between views. */
export interface ViewParts {
  readonly api: Api;
  readonly page: MapPage;
  readonly work: Workspace;
  readonly path: PagePath;
  readonly go: Go;
  /** Opens one channel's own view. */
  readonly openChannel: (channelId: string) => void;
  /** The conversation with the AI, shared with the Ask panel. */
  readonly ask: AskSession;
  /** Tells the browser tab the name of the channel or video whose page is on screen. */
  readonly nameScreen: (id: string, name: string) => void;
  /** Ask opened large: what it is about, and the way back to the panel. */
  readonly askLarge: {
    readonly context: AskContext | null;
    readonly shrink: () => void;
  };
}

/** Which AI answers, as the side panels and Settings take it. */
export const aiOf = (work: Workspace): AiChoice => ({
  choice: work.analysis.choice,
  engines: work.analysis.engines,
  busy: work.asking,
  choose: work.analysis.choose,
  checkPictures: work.analysis.checkPictures,
});

/** Draws one view; a table of these is a group of the rail. */
export type ViewDraw = (parts: ViewParts) => ReactNode;

/** Said in a screen that needs a map when none is on screen yet: one line and one button. */
export function NeedsMap({ view }: { readonly view: ViewId }) {
  const title =
    view === 'channel'
      ? 'Add your channel to see how it is doing'
      : `${VIEWS[view].title} needs your channel first`;
  return (
    <section className="w-full px-4 py-space-lg sm:px-8">
      <div className="mx-auto max-w-[1260px]">
        <div className="max-w-2xl">
          <EmptyState
            icon={Radar}
            title={title}
            line="Open one of your channels on Today, or paste a channel there and press Find competitors."
            action={
              <Button kind="main" href={viewHref('home')}>
                Go to Today
              </Button>
            }
          />
        </div>
      </div>
    </section>
  );
}

/** The view drawn from the map on screen, or the note that it needs one. */
export function withMap(
  view: ViewId,
  draw: (snapshot: MapSnapshot, parts: ViewParts) => ReactNode,
): ViewDraw {
  return (parts) => {
    const { snapshot } = parts.page;
    return snapshot ? draw(snapshot, parts) : <NeedsMap view={view} />;
  };
}
