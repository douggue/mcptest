/**
 * The routes of the later features, each in a file of its own and gathered
 * here so the app registers them once. Every write passes the Host, Origin
 * and JSON checks the other routes use, and every body is checked with zod.
 */
import type { AnalysisTracker } from './analysisRoutes';
import type { AppOptions } from './app';
import { ALERTS_ROUTES } from './alertsRoutes';
import { CHANGES_ROUTES } from './changesRoutes';
import { COMMENTS_ROUTES } from './commentsRoutes';
import { readExtrasJob, type ExtrasContext, type ExtrasRouteTable } from './extrasJobs';
import { fail } from './http';
import { CALENDAR_ROUTES } from './calendarRoutes';
import { MONEY_ROUTES } from './moneyRoutes';
import { PACING_ROUTES } from './pacingRoutes';
import { PLAN_ROUTES } from './planRoutes';
import { PROFILE_ROUTES } from './profileRoutes';
import { RISK_ROUTES } from './riskRoutes';
import { THUMB_REVIEW_ROUTES } from './thumbReviewRoutes';
import { JobStore } from './jobs';

const ROUTES: ExtrasRouteTable = {
  ...CHANGES_ROUTES,
  ...ALERTS_ROUTES,
  ...PLAN_ROUTES,
  ...CALENDAR_ROUTES,
  ...PACING_ROUTES,
  ...COMMENTS_ROUTES,
  ...RISK_ROUTES,
  ...PROFILE_ROUTES,
  ...THUMB_REVIEW_ROUTES,
  ...MONEY_ROUTES,
  '/api/extras/job': { GET: (context, _request, url) => readExtrasJob(context, url) },
};

export interface ExtraRoutes {
  /** The answer to a request for one of these paths; null for any other path. */
  handle(request: Request, url: URL): Promise<Response> | null;
}

export function extraRoutes(options: AppOptions, tracker: AnalysisTracker): ExtraRoutes {
  const context: ExtrasContext = {
    options,
    jobs: new JobStore(),
    tracker,
    extraJobs: new JobStore(),
  };
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
