import { z } from 'zod';
import type { AllowReport } from './engines/allowAgy';
import { fail, ok, readJson } from './http';
import { cleanMessage } from './jobs';
import type { SaveOutcome, SettingsView } from './settingsStore';

/**
 * The settings screen's routes. Reading is a GET; every change is a POST with
 * the same Host, Origin and JSON checks as the other routes. A key's value
 * comes in with a change and never goes out again.
 */

export const SETTINGS_PATH = '/api/settings';
export const PROGRAMS_PATH = '/api/settings/programs';
export const ALLOW_AGY_PATH = '/api/settings/allow-antigravity';

/** No setting is longer than a full path. */
const MAX_VALUE_LENGTH = 1000;
const MAX_CHANGES = 20;
/** Room for a full path in each of a handful of settings. */
const MAX_BODY_CHARACTERS = 8000;

/** What `npm run engines` prints, as its lines. */
export interface ProgramsReport {
  readonly engines: readonly string[];
  readonly helpers: readonly string[];
}

/** What the routes need; `main.ts` wires it to the `.env` file and the running engine. */
export interface SettingsEngine {
  view(): SettingsView;
  save(changes: Readonly<Record<string, string | null>>): SaveOutcome;
  /** Which AI programs and helper programs are found on this computer. Starts nothing that spends allowance. */
  programs(): Promise<ProgramsReport>;
  /** Lets Antigravity use Jgtube's tools, by one line in its own settings. */
  allowAntigravity(): AllowReport;
}

const saveRequest = z.object({
  changes: z
    .record(z.string().max(100), z.string().max(MAX_VALUE_LENGTH).nullable())
    .refine((changes) => Object.keys(changes).length <= MAX_CHANGES),
});

async function save(
  settings: SettingsEngine,
  allowedHosts: readonly string[],
  request: Request,
): Promise<Response> {
  const body = await readJson(allowedHosts, request, MAX_BODY_CHARACTERS);
  if (body instanceof Response) return body;
  const parsed = saveRequest.safeParse(body);
  // The body may hold a key, so nothing of it is repeated.
  if (!parsed.success) return fail(400, 'Give the settings to change, by name');
  const outcome = settings.save(parsed.data.changes);
  return outcome.ok
    ? ok({ ...outcome.view, restart: outcome.restart })
    : fail(400, outcome.problem);
}

async function allow(
  settings: SettingsEngine,
  allowedHosts: readonly string[],
  request: Request,
): Promise<Response> {
  const body = await readJson(allowedHosts, request);
  if (body instanceof Response) return body;
  try {
    return ok(settings.allowAntigravity());
  } catch (error) {
    return fail(500, `Antigravity's settings could not be changed: ${cleanMessage(error)}`);
  }
}

async function programs(settings: SettingsEngine): Promise<Response> {
  try {
    return ok(await settings.programs());
  } catch (error) {
    return fail(502, `The programs could not be checked: ${cleanMessage(error)}`);
  }
}

/**
 * Answers a request to one of the settings routes, or null when the path is
 * not one of them. `settings` is absent where Jgtube runs with no `.env` to
 * write (a test, the connector), and the routes then say so.
 */
export function settingsRoute(
  settings: SettingsEngine | undefined,
  allowedHosts: readonly string[],
  request: Request,
  pathname: string,
): Promise<Response> | Response | null {
  const paths: readonly string[] = [SETTINGS_PATH, PROGRAMS_PATH, ALLOW_AGY_PATH];
  if (!paths.includes(pathname)) return null;
  if (!settings) return fail(404, 'Settings cannot be changed from here');
  const { method } = request;
  if (pathname === PROGRAMS_PATH) {
    return method === 'GET' ? programs(settings) : fail(405, 'Use GET');
  }
  if (pathname === ALLOW_AGY_PATH) {
    return method === 'POST' ? allow(settings, allowedHosts, request) : fail(405, 'Use POST');
  }
  if (method === 'GET') return ok({ ...settings.view(), restart: [] });
  return method === 'POST' ? save(settings, allowedHosts, request) : fail(405, 'Use GET or POST');
}
