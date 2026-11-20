/**
 * Runs Claude Code once, without a chat window, to answer one question with
 * Jgtube's own tools. This is how a button in the app gets Claude's judgement
 * using the owner's existing Claude login: no API key is involved.
 *
 * The run is boxed in. It sees only the tool servers named in the request,
 * ignores the owner's other Claude settings, may use only the tools on the
 * allow list, and is denied everything that reads files, edits or runs
 * commands. It is stopped if it runs too long or says too much.
 */
import { spawn as nodeSpawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { z } from 'zod';
import { cleanMessage } from './jobs';

const COMMAND = 'claude';
/** Claude Code's built-in tools that a boxed-in analysis must never have. */
const DENIED_TOOLS: readonly string[] = [
  'Bash',
  'Edit',
  'Write',
  'Read',
  'Glob',
  'Grep',
  'NotebookEdit',
  'WebFetch',
  'WebSearch',
  'Agent',
  'Task',
  'TodoWrite',
];
/** Never passed on: with an API key present Claude Code would bill it instead of using the login. */
const WITHHELD_ENV: readonly string[] = ['ANTHROPIC_API_KEY', 'YOUTUBE_API_KEY'];
const MAX_OUTPUT_CHARACTERS = 2_000_000;
const MAX_ERROR_DETAIL = 300;
/** A process asked to stop is given this long to go before it is forced. */
const KILL_GRACE_MS = 2000;
const LIMIT_PATTERN = /hit your .*limit|usage limit|rate limit/i;

export interface McpServerSpec {
  readonly command: string;
  readonly args: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
}

export interface ClaudeRunRequest {
  readonly prompt: string;
  /** Replaces Claude Code's own instructions, which are about writing software. */
  readonly systemPrompt: string;
  /** The only tool servers the run can see, by name. */
  readonly mcpServers: Readonly<Record<string, McpServerSpec>>;
  /** Full tool names, such as `mcp__jgtube__get_map`. */
  readonly allowedTools: readonly string[];
  readonly maxTurns: number;
  readonly timeoutMs: number;
  /** Where the run starts. An empty folder, so no project settings are picked up. */
  readonly cwd: string;
}

export interface ClaudeRunResult {
  readonly text: string;
  readonly turns: number | null;
}

/** 'limit': the owner's Claude plan has no capacity left for now. */
export type ClaudeFailure = 'not-installed' | 'timeout' | 'limit' | 'failed';

export class ClaudeRunError extends Error {
  constructor(
    readonly reason: ClaudeFailure,
    message: string,
  ) {
    super(message);
    this.name = 'ClaudeRunError';
  }
}

interface Emitter {
  on(event: string, listener: (...values: unknown[]) => void): unknown;
}

/** 'SIGTERM' asks the process to stop; 'SIGKILL' stops it whether it likes it or not. */
export type StopSignal = 'SIGTERM' | 'SIGKILL';

/** The parts of a running process this module uses, so tests can stand in for one. */
export interface ClaudeChild extends Emitter {
  readonly stdout: Emitter;
  readonly stderr: Emitter;
  kill(signal?: StopSignal): void;
}

export type SpawnClaude = (
  command: string,
  args: readonly string[],
  options: { readonly cwd: string; readonly env: Readonly<Record<string, string | undefined>> },
) => ClaudeChild;

export interface ClaudeRunDeps {
  readonly spawn: SpawnClaude;
  readonly env: Readonly<Record<string, string | undefined>>;
  /** How long a process asked to stop is given before it is forced; tests shorten it. */
  readonly killGraceMs?: number;
  /** The operating system, which changes the wording of one message; tests set it. */
  readonly platform?: string;
  /** Aborted when Jgtube is closing: the run is stopped, or never started. */
  readonly signal?: AbortSignal;
}

const replySchema = z.object({
  type: z.literal('result'),
  subtype: z.string().optional(),
  is_error: z.boolean().optional(),
  result: z.string().optional(),
  num_turns: z.number().optional(),
});

/** The command line for one boxed-in run. The prompt is an argument, never shell text. */
export function buildClaudeArgs(request: ClaudeRunRequest): readonly string[] {
  return [
    '-p',
    request.prompt,
    '--output-format',
    'json',
    '--max-turns',
    String(request.maxTurns),
    '--system-prompt',
    request.systemPrompt,
    '--strict-mcp-config',
    '--mcp-config',
    JSON.stringify({ mcpServers: request.mcpServers }),
    '--setting-sources',
    'project',
    '--permission-mode',
    'dontAsk',
    // No built-in tools exist in the run at all; the deny list below is a second lock.
    '--tools',
    '',
    '--allowedTools',
    ...request.allowedTools,
    '--disallowedTools',
    ...DENIED_TOOLS,
  ];
}

function withoutKeys(
  env: Readonly<Record<string, string | undefined>>,
): Record<string, string | undefined> {
  return Object.fromEntries(Object.entries(env).filter(([name]) => !WITHHELD_ENV.includes(name)));
}

/** Turns what the process printed into an answer, or the reason there is none. */
function readReply(output: string, errorText: string, exitCode: number | null): ClaudeRunResult {
  let parsed: ReturnType<typeof replySchema.safeParse>;
  try {
    parsed = replySchema.safeParse(JSON.parse(output));
  } catch {
    parsed = replySchema.safeParse(null);
  }
  if (!parsed.success) {
    const detail = cleanMessage(errorText).trim().slice(0, MAX_ERROR_DETAIL);
    throw new ClaudeRunError(
      'failed',
      `Claude Code stopped without an answer (exit code ${String(exitCode)})${detail ? `: ${detail}` : ''}`,
    );
  }
  const { subtype, is_error: isError, result, num_turns: turns } = parsed.data;
  if (!isError && subtype === 'success' && result !== undefined) {
    return { text: result, turns: turns ?? null };
  }
  const said = cleanMessage(result ?? '')
    .trim()
    .slice(0, MAX_ERROR_DETAIL);
  if (LIMIT_PATTERN.test(said)) throw new ClaudeRunError('limit', said);
  if (subtype === 'error_max_turns') {
    throw new ClaudeRunError('failed', 'Claude ran out of steps before it finished. Try again.');
  }
  throw new ClaudeRunError('failed', said || 'Claude could not finish the analysis.');
}

/** Whether a start-up error means the program is not there to run. */
const isMissingProgram = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'ENOENT';

/**
 * Why Claude Code could not be started. On Windows a Claude Code installed as
 * `claude.cmd` cannot be started without going through a shell, and a prompt
 * is never passed through a shell, so there the message says what is needed.
 */
function startFailure(error: unknown, platform: string): ClaudeRunError {
  if (!isMissingProgram(error)) {
    return new ClaudeRunError('failed', `Claude Code could not be started: ${cleanMessage(error)}`);
  }
  return new ClaudeRunError(
    'not-installed',
    platform === 'win32'
      ? 'Claude Code could not be started. The Ask Claude buttons need Claude Code reachable as `claude`, and are verified on macOS and Linux only.'
      : 'Claude Code is not installed on this computer, or cannot be found. Install it and sign in, then try again.',
  );
}

interface TextCollector {
  /** Takes the next piece of the stream. True when it did not all fit under the limit. */
  add(chunk: unknown): boolean;
  /** Everything taken so far. */
  end(): string;
}

/**
 * Gathers what a process prints, up to a limit. Bytes are decoded as one
 * UTF-8 stream, so a character that arrives split across two pieces is read
 * whole instead of as two broken halves.
 */
function collectText(limit: number): TextCollector {
  const decoder = new StringDecoder('utf8');
  let text = '';
  return {
    add(chunk) {
      const piece = Buffer.isBuffer(chunk) ? decoder.write(chunk) : String(chunk);
      const room = limit - text.length;
      text += piece.slice(0, Math.max(room, 0));
      return piece.length > room;
    },
    end: () => (text + decoder.end()).slice(0, limit),
  };
}

/** Asks the process to stop and, if it has not gone after `graceMs`, forces it. */
function stopProcess(child: ClaudeChild, graceMs: number): void {
  child.kill('SIGTERM');
  const force = setTimeout(() => child.kill('SIGKILL'), graceMs);
  // Waiting to force a process must not keep Jgtube itself from closing.
  force.unref();
  child.on('close', () => clearTimeout(force));
}

const closingError = (): ClaudeRunError =>
  new ClaudeRunError('failed', 'Claude was stopped because Jgtube is closing.');
const timeoutError = (): ClaudeRunError =>
  new ClaudeRunError('timeout', 'Claude took too long and was stopped. Try again.');
const tooMuchError = (): ClaudeRunError =>
  new ClaudeRunError('failed', 'Claude sent more than could be read and was stopped.');

/** The answer in what the process printed; rejects with the reason when there is none. */
const replyOf = (output: string, errorText: string, code: unknown): Promise<ClaudeRunResult> =>
  new Promise((resolve) => {
    resolve(readReply(output, errorText, typeof code === 'number' ? code : null));
  });

/** Runs Claude Code once and resolves with its answer. Rejects with a ClaudeRunError. */
export function runClaude(
  request: ClaudeRunRequest,
  deps: ClaudeRunDeps,
): Promise<ClaudeRunResult> {
  if (deps.signal?.aborted) return Promise.reject(closingError());
  return new Promise((resolve, reject) => {
    const child = deps.spawn(COMMAND, buildClaudeArgs(request), {
      cwd: request.cwd,
      env: withoutKeys(deps.env),
    });
    const output = collectText(MAX_OUTPUT_CHARACTERS);
    const errorText = collectText(MAX_OUTPUT_CHARACTERS);
    let settled = false;
    const settle = (finish: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      finish();
    };
    const stop = (error: ClaudeRunError): void =>
      settle(() => {
        stopProcess(child, deps.killGraceMs ?? KILL_GRACE_MS);
        reject(error);
      });
    const timer = setTimeout(() => stop(timeoutError()), request.timeoutMs);

    deps.signal?.addEventListener('abort', () => stop(closingError()), { once: true });

    // Once the verdict is in, whatever else the process prints is not kept.
    child.stdout.on('data', (chunk: unknown) => {
      if (!settled && output.add(chunk)) stop(tooMuchError());
    });
    child.stderr.on('data', (chunk: unknown) => {
      if (!settled) errorText.add(chunk);
    });
    child.on('error', (error: unknown) =>
      settle(() => reject(startFailure(error, deps.platform ?? process.platform))),
    );
    child.on('close', (code: unknown) =>
      settle(() => resolve(replyOf(output.end(), errorText.end(), code))),
    );
  });
}

/** Starts the real program. Its input is closed: the prompt travels as an argument. */
export const spawnClaude: SpawnClaude = (command, args, options) => {
  const child = nodeSpawn(command, [...args], {
    cwd: options.cwd,
    env: options.env as NodeJS.ProcessEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return {
    stdout: child.stdout,
    stderr: child.stderr,
    on: (event, listener) => child.on(event, listener as (...values: unknown[]) => void),
    kill: (signal) => child.kill(signal),
  };
};
