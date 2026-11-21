/**
 * Runs the Antigravity CLI (`agy`) once, without a chat window, to answer one
 * question with Jgtube's own tools, on the owner's Google login.
 *
 * NOT RUN FROM HERE. `agy` was not installed where this was written. What
 * follows is built to its documentation for v1.5.12 (headless mode, MCP,
 * permissions, settings, sandbox, FAQ), and every assumption about it is in
 * this file and `agyReply.ts`.
 *
 * How the tools reach it. `agy` has no flag for tool servers. It reads
 * `<working folder>/.agents/mcp_config.json`, so that file is written into a
 * fresh folder made for the one run and removed with it afterwards. A fresh
 * folder each time matters: `agy` may write inside its working folder, and
 * anything left there (hooks, plugins) would be loaded by the next run.
 *
 * What the owner must do once. A tool with no rule is "ask", and a headless
 * run cannot ask, so it is quietly refused. The documented way to allow one is
 * a rule in the owner's own settings file (`settings.json` under `.gemini`,
 * `antigravity-cli` in the home folder). The documentation shows no settings
 * file for a single folder, and Jgtube never writes to the owner's file. So
 * the file is only read: while the rule `mcp(<server>/*)` is missing the
 * engine is passed over, before anything is spent, with the line to add.
 *
 * The box, and its holes:
 * - Only the allowed tools of the connector are offered (`enabledTools`).
 * - `--sandbox` keeps commands away from the network and from files outside
 *   the working folder, where the sandbox exists (not on Windows 10).
 * - Unless the owner's settings say otherwise, a headless run is refused web
 *   pages and files outside its folder, since those would have to ask. Since
 *   v1.5.7 it may edit files in its working folder and run commands inside the
 *   sandbox without asking. Rules that deny those (`command(*)`,
 *   `write_file(*)`, `read_url(*)`, `execute_url(*)`) exist, but only in the
 *   owner's settings, where they would apply to every use of `agy`.
 * - It cannot be told to ignore the owner's other tool servers, plugins and
 *   hooks, which load as in any `agy` session.
 * - It has no place for a system prompt and no limit on steps: the
 *   instructions go ahead of the question, and only the time limit bounds it.
 *
 * Pictures. The CLI passes on only the text of a tool's results, so a
 * request's `files` (pictures made or fetched by Jgtube, under names made in
 * code) are written into the run folder and the prompt names them as `@name`.
 * Whether a run really looks at them is what the picture check finds out.
 *
 * Google's FAQ says that wrapping `agy` inside other applications "is not
 * supported under consumer plans" and recommends an API key instead. The
 * owner has been told and chose to use it.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { permissionHelp, readAgyReply } from './agyReply';
import { EngineRunError, plainJson, promptWithInstructions, toolsOf } from './failure';
import { installedVersion, statusOf } from './probe';
import { runProcess } from './process';
import type {
  AnalysisEngine,
  EngineDeps,
  EngineRunRequest,
  EngineRunResult,
  EngineStatus,
  FileLookup,
  Program,
  RunFile,
} from './types';

export const AGY: Program = { command: 'agy', label: 'Antigravity CLI', name: 'Antigravity' };
/** Where the owner's own settings live, under their home folder. Read, never written. */
export const SETTINGS_FILE = ['.gemini', 'antigravity-cli', 'settings.json'] as const;
/** Where a working folder's tool servers are read from. */
const MCP_CONFIG_FOLDER = '.agents';
const MCP_CONFIG_FILE = 'mcp_config.json';
/** Each run gets a new folder with this prefix inside the private working folder. */
const RUN_FOLDER_PREFIX = 'run-';
const OWNER_ONLY_FOLDER = 0o700;
const OWNER_ONLY_FILE = 0o600;
const MS_PER_MINUTE = 60_000;
/** `agy` is given its own time limit; it is stopped from here this long after, if it is still going. */
const STOP_MARGIN_MS = 15_000;
/**
 * The prompt is a command-line argument, so the instructions and the question
 * are joined on one line: a line break is the one thing that cannot be passed
 * to a program installed as a Windows `.cmd` file.
 */
export const ONE_LINE = ' ';
/** The setting under which `agy` asks about nothing at all. */
const ALLOW_EVERYTHING = 'always-proceed';

export interface AgyOptions {
  /** The tool server whose tools the owner's settings must allow. */
  readonly toolServer: string;
  /** A model to ask for; absent, `agy` uses the owner's own choice. */
  readonly model?: string | undefined;
}

const settingsSchema = z.object({
  toolPermission: z.string().optional(),
  permissions: z
    .object({
      allow: z.array(z.string()).optional(),
      deny: z.array(z.string()).optional(),
    })
    .optional(),
});

const realFiles: FileLookup = {
  exists: (path) => existsSync(path),
  read: (path) => readFileSync(path, 'utf8'),
};

/** `agy`'s own time limit for a run, in whole minutes. */
export const printTimeout = (timeoutMs: number): string =>
  `${Math.max(1, Math.ceil(timeoutMs / MS_PER_MINUTE))}m`;

/** The command line for one run with tools. The prompt is an argument, never shell text. */
export function buildAgyArgs(prompt: string, timeoutMs: number, model?: string): readonly string[] {
  return [
    '-p',
    prompt,
    '--output-format',
    'json',
    '--sandbox',
    '--print-timeout',
    printTimeout(timeoutMs),
    ...(model ? ['--model', model] : []),
  ];
}

/** The tool servers of a request, as the file `agy` reads them from. */
export function agyMcpConfig(request: EngineRunRequest): {
  readonly mcpServers: Readonly<Record<string, unknown>>;
} {
  return {
    mcpServers: Object.fromEntries(
      Object.entries(request.mcpServers).map(([name, server]) => [
        name,
        {
          command: server.command,
          args: server.args,
          ...(server.env ? { env: server.env } : {}),
          enabledTools: toolsOf(name, request.allowedTools),
        },
      ]),
    ),
  };
}

/**
 * Whether the owner's settings let a headless run use a server's tools:
 * a rule for every tool, for the server or for all servers, and no rule
 * denying the same. `settingsText` is the file as text, or null without one.
 */
export function allowsServer(
  settingsText: string | null,
  server: string,
  tools: readonly string[],
): boolean {
  let settings: z.infer<typeof settingsSchema>;
  try {
    settings = settingsSchema.parse(JSON.parse(plainJson(settingsText ?? '')));
  } catch {
    return false;
  }
  const whole = ['mcp(*)', `mcp(${server}/*)`];
  if (settings.permissions?.deny?.some((rule) => whole.includes(rule))) return false;
  if (settings.toolPermission === ALLOW_EVERYTHING) return true;
  const allow = settings.permissions?.allow ?? [];
  // With no tools named (the status check), any rule that names one of the server's tools counts.
  const eachTool =
    tools.length > 0
      ? tools.every((tool) => allow.includes(`mcp(${server}/${tool})`))
      : allow.some((rule) => rule.startsWith(`mcp(${server}/`));
  return eachTool || allow.some((rule) => whole.includes(rule));
}

export type AllowOutcome =
  | { readonly ok: true; readonly changed: boolean; readonly text: string }
  | { readonly ok: false; readonly problem: string };

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The owner's Antigravity settings with the one rule added that lets a run
 * started by Jgtube use the server's tools, everything else left as it was.
 * Settings that cannot be read, or that deny the tools, are refused, never
 * overwritten. The rule names every tool of the server: which of them a run
 * may use is held by the connector itself, not by this file.
 */
export function allowServerInSettings(settingsText: string | null, server: string): AllowOutcome {
  const rule = `mcp(${server}/*)`;
  if (settingsText === null || settingsText.trim() === '') {
    return { ok: true, changed: true, text: asSettingsText({ permissions: { allow: [rule] } }) };
  }
  let settings: unknown;
  let trouble = 'it does not hold a list of settings in braces';
  try {
    settings = JSON.parse(plainJson(settingsText)) as unknown;
  } catch (error) {
    settings = null;
    // Where in the file, never what is there: a settings file can hold keys.
    const position = /position (\d+)/.exec(error instanceof Error ? error.message : '')?.[1];
    trouble = position
      ? `something is out of place near character ${position}`
      : 'it is not valid JSON';
  }
  if (!isObject(settings)) {
    return {
      ok: false,
      problem: `The settings file cannot be read as settings (${trouble}), so it was left alone.`,
    };
  }
  const permissions = isObject(settings['permissions']) ? settings['permissions'] : {};
  const listed = (key: string): readonly unknown[] =>
    Array.isArray(permissions[key]) ? (permissions[key] as readonly unknown[]) : [];
  if (listed('deny').some((entry) => entry === rule || entry === 'mcp(*)')) {
    return { ok: false, problem: `The settings deny ${rule}. Remove that line from "deny" first.` };
  }
  if (allowsServer(settingsText, server, []))
    return { ok: true, changed: false, text: settingsText };
  const next = { ...settings, permissions: { ...permissions, allow: [...listed('allow'), rule] } };
  return { ok: true, changed: true, text: asSettingsText(next) };
}

const asSettingsText = (settings: unknown): string => `${JSON.stringify(settings, null, 2)}\n`;

function readSettings(deps: EngineDeps): string | null {
  const files = deps.files ?? realFiles;
  try {
    return files.read(join(deps.homeDir ?? homedir(), ...SETTINGS_FILE));
  } catch {
    return null;
  }
}

/** The first server of a request whose tools the owner's settings do not allow, or null. */
function refusedServer(request: EngineRunRequest, deps: EngineDeps): string | null {
  const settings = readSettings(deps);
  const names = Object.keys(request.mcpServers);
  return (
    names.find((name) => !allowsServer(settings, name, toolsOf(name, request.allowedTools))) ?? null
  );
}

/** How long deleting a folder keeps trying while a program is still letting go of it. */
const RM_RETRIES = { maxRetries: 5, retryDelay: 200 };

/**
 * Does `work` in a new, owner-only folder inside `parent`, and removes the
 * folder afterwards whatever happened.
 */
export async function inRunFolder<T>(
  parent: string,
  work: (folder: string) => Promise<T>,
): Promise<T> {
  await mkdir(parent, { recursive: true, mode: OWNER_ONLY_FOLDER });
  const folder = await mkdtemp(join(parent, RUN_FOLDER_PREFIX));
  try {
    return await work(folder);
  } finally {
    // A program that has not quite gone still holds its folder, and Windows will
    // not delete it then. Failing to tidy up must never replace the run's own
    // outcome: what is left is removed the next time Jgtube starts its engines.
    await rm(folder, { recursive: true, force: true, ...RM_RETRIES }).catch(() => undefined);
  }
}

/** A file name made in code: letters, digits, dots, dashes; no folder, nothing hidden. */
const SAFE_FILE_NAME = /^[a-z0-9][a-z0-9._-]{0,99}$/i;

/** Rejects, before anything is started, when a file name could reach outside the run folder. */
function checkFileNames(files: readonly RunFile[]): void {
  const bad = files.find((file) => !SAFE_FILE_NAME.test(file.name) || file.name.includes('..'));
  if (bad) throw new EngineRunError('failed', 'A picture had a file name Jgtube does not use.');
}

/** Puts the request's pictures into the run folder, readable by the owner only. */
async function writeFiles(folder: string, files: readonly RunFile[]): Promise<void> {
  for (const file of files) {
    await writeFile(join(folder, file.name), file.bytes, { mode: OWNER_ONLY_FILE });
  }
}

async function writeMcpConfig(folder: string, request: EngineRunRequest): Promise<void> {
  const configFolder = join(folder, MCP_CONFIG_FOLDER);
  await mkdir(configFolder, { mode: OWNER_ONLY_FOLDER });
  await writeFile(join(configFolder, MCP_CONFIG_FILE), JSON.stringify(agyMcpConfig(request)), {
    mode: OWNER_ONLY_FILE,
  });
}

/** Runs `agy` once with the request's tools. Rejects with an EngineRunError. */
async function runAgy(
  request: EngineRunRequest,
  deps: EngineDeps,
  options: AgyOptions,
): Promise<EngineRunResult> {
  const refused = refusedServer(request, deps);
  // Like a missing sign-in, this is one step for the owner to take in the program itself.
  if (refused !== null) throw new EngineRunError('not-signed-in', permissionHelp(refused));
  const files = request.files ?? [];
  checkFileNames(files);
  const prompt = promptWithInstructions(request.systemPrompt, request.prompt, ONE_LINE);
  return inRunFolder(request.cwd, async (folder) => {
    await writeMcpConfig(folder, request);
    await writeFiles(folder, files);
    const output = await runProcess(
      {
        program: AGY,
        args: buildAgyArgs(prompt, request.timeoutMs, options.model),
        cwd: folder,
        timeoutMs: request.timeoutMs + STOP_MARGIN_MS,
      },
      deps,
    );
    return readAgyReply(output, Object.keys(request.mcpServers));
  });
}

async function checkAgy(deps: EngineDeps, options: AgyOptions): Promise<EngineStatus> {
  const found = await installedVersion(AGY, deps);
  const allowed = allowsServer(readSettings(deps), options.toolServer, []);
  return statusOf('agy', AGY.label, {
    ...found,
    // `agy` has no way to say whether someone is signed in short of asking it a question.
    signedIn: null,
    blockedBy: allowed ? null : permissionHelp(options.toolServer),
  });
}

export function createAgyEngine(options: AgyOptions): AnalysisEngine {
  return {
    id: 'agy',
    label: AGY.label,
    run: (request, deps) => runAgy(request, deps, options),
    check: (deps) => checkAgy(deps, options),
  };
}
