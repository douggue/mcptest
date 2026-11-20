/**
 * Runs the Codex CLI once, without a chat window, to answer one question with
 * Jgtube's own tools, on the owner's ChatGPT login.
 *
 * NOT RUN FROM HERE. Codex was not installed where this was written. Everything
 * below follows its documentation for v0.171.0 (non-interactive mode, the
 * command-line reference and the configuration reference), and every
 * assumption about it is in this file: the command line in `buildCodexArgs`,
 * the settings in `configOverrides`, the shape of its events in `eventSchema`,
 * and what counts as an answer in `readEvents`.
 *
 * The box, as far as Codex's documented controls go:
 * - `--ignore-user-config`: the owner's `config.toml`, and so their other tool
 *   servers, are not loaded. The login is still read.
 * - `--sandbox read-only` and `features.shell_tool=false`: no command runs, and
 *   nothing could be written if one did.
 * - `web_search="disabled"` and `features.view_image=false`: no web search and
 *   no opening of image files on the computer.
 * - The connector is the only tool server, offered with only the allowed tools
 *   (`enabled_tools`) and required, so a run without it fails instead of
 *   answering from nothing.
 * - `CODEX_API_KEY` and `OPENAI_API_KEY` are withheld, so the login is used.
 *
 * What it cannot prevent: Codex still reads the owner's own instruction file
 * (`AGENTS.md` in its home folder) if there is one, and it has no setting for
 * a limit on steps, so only the time limit bounds a run.
 *
 * Known caveats, from its documentation:
 * - A non-interactive run refuses a tool not marked read-only unless its
 *   approval is set ahead of time; `default_tools_approval_mode="approve"`
 *   does that for the connector's tools.
 * - A picture in a tool's result is dropped when the same result also carries
 *   structured content. The connector's picture tool sends none.
 * - It takes pictures but not video.
 * - OpenAI recommends an API key for use from a program, and describes using
 *   the ChatGPT login this way only for "trusted private automation".
 * - It has no overall time limit of its own; the one here is enforced by
 *   stopping the process.
 */
import { z } from 'zod';
import { EngineRunError, failureKind, promptWithInstructions, said, toolsOf } from './failure';
import { ask, installedVersion, statusOf } from './probe';
import { runProcess, type ProcessOutput } from './process';
import { tomlValue, type TomlValue } from './toml';
import type {
  AnalysisEngine,
  EngineDeps,
  EngineRunRequest,
  EngineRunResult,
  EngineStatus,
  McpServerSpec,
  Program,
} from './types';

const CODEX: Program = { command: 'codex', label: 'Codex CLI', name: 'Codex' };
/** `codex login status` exits with this when someone is signed in. */
const SIGNED_IN_EXIT = 0;
/**
 * Codex gives a tool server 10 seconds to start. The connector is started
 * through a TypeScript runner, which can take longer on a slow disk.
 */
const SERVER_STARTUP_SECONDS = 30;
/** A server name is part of a setting's key, so it must be a plain TOML key. */
const PLAIN_KEY = /^[A-Za-z0-9_-]+$/;
const NOT_SIGNED_IN =
  'Nobody is signed in to Codex CLI. Open a terminal, type "codex login" and follow it, then try again.';

const eventSchema = z.object({
  type: z.string(),
  item: z.object({ type: z.string().optional(), text: z.string().optional() }).optional(),
  message: z.string().optional(),
  error: z.object({ message: z.string().optional() }).optional(),
});
type CodexEvent = z.infer<typeof eventSchema>;

function serverOverrides(
  name: string,
  server: McpServerSpec,
  allowedTools: readonly string[],
): ReadonlyArray<readonly [string, TomlValue]> {
  if (!PLAIN_KEY.test(name)) {
    throw new Error('A tool server name may hold only letters, digits, "-" and "_"');
  }
  const key = (setting: string): string => `mcp_servers.${name}.${setting}`;
  return [
    [key('command'), server.command],
    [key('args'), server.args],
    ...(server.env ? [[key('env'), server.env] as const] : []),
    [key('required'), true],
    [key('startup_timeout_sec'), SERVER_STARTUP_SECONDS],
    [key('default_tools_approval_mode'), 'approve'],
    [key('enabled_tools'), toolsOf(name, allowedTools)],
  ];
}

/** The settings given on the command line, each a key and a value. */
function configOverrides(request: EngineRunRequest): ReadonlyArray<readonly [string, TomlValue]> {
  return [
    ['web_search', 'disabled'],
    ['features.shell_tool', false],
    ['features.view_image', false],
    ...Object.entries(request.mcpServers).flatMap(([name, server]) =>
      serverOverrides(name, server, request.allowedTools),
    ),
  ];
}

/** The command line for one boxed-in run. The prompt is not on it: it goes to the input. */
export function buildCodexArgs(request: EngineRunRequest): readonly string[] {
  return [
    'exec',
    '--json',
    '--ephemeral',
    '--skip-git-repo-check',
    '--ignore-user-config',
    '--sandbox',
    'read-only',
    '-C',
    request.cwd,
    ...configOverrides(request).flatMap(([key, value]) => ['-c', `${key}=${tomlValue(value)}`]),
    '-',
  ];
}

/** The events among the lines Codex printed; a line that is not one is skipped. */
function parseEvents(stdout: string): readonly CodexEvent[] {
  return stdout.split('\n').flatMap((text) => {
    try {
      const parsed = eventSchema.safeParse(JSON.parse(text));
      return parsed.success ? [parsed.data] : [];
    } catch {
      return [];
    }
  });
}

const isAnswer = (event: CodexEvent): boolean =>
  event.type === 'item.completed' && event.item?.type === 'agent_message';
const problemOf = (event: CodexEvent): string | undefined =>
  event.type === 'turn.failed' || event.type === 'error'
    ? (event.error?.message ?? event.message)
    : undefined;

/** Turns what Codex printed into an answer, or the reason there is none. */
function readEvents({ stdout, stderr, code }: ProcessOutput): EngineRunResult {
  const events = parseEvents(stdout);
  const answer = events.filter(isAnswer).at(-1)?.item?.text;
  const turnFailed = events.some((event) => event.type === 'turn.failed');
  // An `error` event can be a hiccup the run got over; only a failed turn or a bad exit ends it.
  if (code === 0 && !turnFailed && answer !== undefined) return { text: answer, turns: null };

  const problem = events.map(problemOf).findLast((message) => message !== undefined);
  if (problem !== undefined) {
    const message = said(problem);
    throw new EngineRunError(failureKind(message), message || 'Codex could not finish.');
  }
  const detail = said(stderr);
  throw new EngineRunError(
    'failed',
    `Codex CLI stopped without an answer (exit code ${String(code)})${detail ? `: ${detail}` : ''}`,
  );
}

/** Whether someone is signed in to Codex. Rejects when Codex cannot be started. */
async function signedIn(deps: EngineDeps): Promise<boolean> {
  const reply = await ask(CODEX, ['login', 'status'], deps);
  if (reply instanceof EngineRunError) throw reply;
  return reply.code === SIGNED_IN_EXIT;
}

/** Runs Codex once and resolves with its answer. Rejects with an EngineRunError. */
export async function runCodex(
  request: EngineRunRequest,
  deps: EngineDeps,
): Promise<EngineRunResult> {
  if (!(await signedIn(deps))) throw new EngineRunError('not-signed-in', NOT_SIGNED_IN);
  const output = await runProcess(
    {
      program: CODEX,
      args: buildCodexArgs(request),
      cwd: request.cwd,
      timeoutMs: request.timeoutMs,
      // Codex has no place for a system prompt, so it goes ahead of the question.
      input: promptWithInstructions(request.systemPrompt, request.prompt),
    },
    deps,
  );
  return readEvents(output);
}

async function checkCodex(deps: EngineDeps): Promise<EngineStatus> {
  const found = await installedVersion(CODEX, deps);
  const login = found.installed ? await signedIn(deps).catch(() => null) : null;
  return statusOf('codex', CODEX.label, { ...found, signedIn: login });
}

export const codexEngine: AnalysisEngine = {
  id: 'codex',
  label: CODEX.label,
  run: runCodex,
  check: checkCodex,
};
