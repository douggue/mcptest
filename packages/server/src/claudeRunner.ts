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

/** The parts of a running process this module uses, so tests can stand in for one. */
export interface ClaudeChild extends Emitter {
  readonly stdout: Emitter;
  readonly stderr: Emitter;
  kill(): void;
}

export type SpawnClaude = (
  command: string,
  args: readonly string[],
  options: { readonly cwd: string; readonly env: Readonly<Record<string, string | undefined>> },
) => ClaudeChild;

export interface ClaudeRunDeps {
  readonly spawn: SpawnClaude;
  readonly env: Readonly<Record<string, string | undefined>>;
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

/** Runs Claude Code once and resolves with its answer. Rejects with a ClaudeRunError. */
export function runClaude(
  request: ClaudeRunRequest,
  deps: ClaudeRunDeps,
): Promise<ClaudeRunResult> {
  return new Promise((resolve, reject) => {
    const child = deps.spawn(COMMAND, buildClaudeArgs(request), {
      cwd: request.cwd,
      env: withoutKeys(deps.env),
    });
    let output = '';
    let errorText = '';
    let settled = false;
    const settle = (finish: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      finish();
    };
    const stop = (error: ClaudeRunError): void =>
      settle(() => {
        child.kill();
        reject(error);
      });
    const timer = setTimeout(
      () => stop(new ClaudeRunError('timeout', 'Claude took too long and was stopped. Try again.')),
      request.timeoutMs,
    );

    child.stdout.on('data', (chunk: unknown) => {
      output += String(chunk);
      if (output.length > MAX_OUTPUT_CHARACTERS) {
        stop(new ClaudeRunError('failed', 'Claude sent more than could be read and was stopped.'));
      }
    });
    child.stderr.on('data', (chunk: unknown) => {
      errorText = (errorText + String(chunk)).slice(0, MAX_OUTPUT_CHARACTERS);
    });
    child.on('error', (error: unknown) =>
      settle(() =>
        reject(
          isMissingProgram(error)
            ? new ClaudeRunError(
                'not-installed',
                'Claude Code is not installed on this computer, or cannot be found. Install it and sign in, then try again.',
              )
            : new ClaudeRunError(
                'failed',
                `Claude Code could not be started: ${cleanMessage(error)}`,
              ),
        ),
      ),
    );
    child.on('close', (code: unknown) =>
      settle(() => {
        try {
          resolve(readReply(output, errorText, typeof code === 'number' ? code : null));
        } catch (error) {
          reject(error);
        }
      }),
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
    kill: () => child.kill(),
  };
};
