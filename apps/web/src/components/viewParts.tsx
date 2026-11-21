import type { MapSnapshot } from '@jgtube/core';
import { Radar } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Api } from '../lib/api';
import { VIEWS, viewHref, type ViewId } from '../lib/routes';
import type { AiChoice } from './AiEngines';
import type { PagePath } from './usePagePath';
import type { Go } from './useRoute';
import type { MapPage } from './useMapPage';
import type { Workspace } from './useWorkspace';

/** Everything a view is drawn from: the map on screen, the workspace and the links between views. */
export interface ViewParts {
  readonly api: Api;
  readonly page: MapPage;
  readonly work: Workspace;
  readonly path: PagePath;
  readonly go: Go;
  /** Opens one channel's own view. */
  readonly openChannel: (channelId: string) => void;
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

/** Said in a view that needs a map when none is on screen yet. */
export function NeedsMap({ view }: { readonly view: ViewId }) {
  return (
    <section className="w-full px-gutter-desktop py-space-xl">
      <div className="mx-auto flex max-w-2xl flex-col items-start gap-space-sm rounded bg-surface-card p-space-lg">
        <Radar aria-hidden="true" className="h-6 w-6 text-primary" />
        <h2 className="text-headline-md text-on-surface">{VIEWS[view].title} needs a map first</h2>
        <p className="text-body-md text-on-surface-variant">
          Open one of your channels on Home, or paste a channel there and press Find competitors.
        </p>
        <a
          href={viewHref('home')}
          className="rounded-full bg-on-surface px-4 py-1.5 text-body-sm font-semibold text-space-deep hover:bg-white"
        >
          Go to Home
        </a>
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
