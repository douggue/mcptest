/**
 * The routes of the later features, each in a file of its own and gathered
 * here so the app registers them once. Every write passes the Host, Origin
 * and JSON checks the other routes use, and every body is checked with zod.
 */
import type { AnalysisTracker } from './analysisRoutes';
import type { AppOptions } from './app';
import { ALERTS_ROUTES } from './alertsRoutes';
import { CHANGES_ROUTES } from './changesRoutes';
import { fail } from './http';
import { JobStore } from './jobs';
import type { Context, Routes } from './labHttp';

const ROUTES: Routes = { ...CHANGES_ROUTES, ...ALERTS_ROUTES };

export interface ExtraRoutes {
  /** The answer to a request for one of these paths; null for any other path. */
  handle(request: Request, url: URL): Promise<Response> | null;
}

export function extraRoutes(options: AppOptions, tracker: AnalysisTracker): ExtraRoutes {
  const context: Context = { options, jobs: new JobStore(), tracker };
  return {
    handle(request, url) {
      const route = ROUTES[url.pathname];
      if (!route) return null;
      const handler =
        request.method === 'GET' ? route.GET : request.method === 'POST' ? route.POST : undefined;
      if (!handler) {
        const allowed = [route.GET ? 'GET' : '', route.POST ? 'POST' : ''].filter(Boolean);
        return Promise.resolve(fail(405, `Use ${allowed.join(' or ')}`));
      }
      return Promise.resolve(handler(context, request, url));
    },
  };
}
