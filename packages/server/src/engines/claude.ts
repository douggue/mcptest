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
import { z } from 'zod';
import { EngineRunError, failureKind, jsonReply, said } from './failure';
import { ask, installedVersion, statusOf } from './probe';
import { runProcess, type ProcessOutput } from './process';
import type {
  AnalysisEngine,
  EngineDeps,
  EngineRunRequest,
  EngineRunResult,
  EngineStatus,
  Program,
} from './types';

const CLAUDE: Program = { command: 'claude', label: 'Claude Code', name: 'Claude' };
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
/**
 * `claude auth status` says whether someone is signed in. A Claude Code too
 * old to know the command would take the two words as a question, so older
 * versions are not asked. 2.1 is known to have it.
 */
const AUTH_STATUS_SINCE: readonly [number, number] = [2, 1];

const replySchema = z.object({
  type: z.literal('result'),
  subtype: z.string().optional(),
  is_error: z.boolean().optional(),
  result: z.string().optional(),
  num_turns: z.number().optional(),
});

const authSchema = z.object({ loggedIn: z.boolean() });

/** The command line for one boxed-in run. The prompt is an argument, never shell text. */
export function buildClaudeArgs(request: EngineRunRequest): readonly string[] {
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

/** What the owner does when Claude Code is signed out, in words they can follow. */
const SIGN_IN_AGAIN =
  'Claude Code is signed out on this computer, or its login has run out. Open a terminal, type "claude auth login", follow it, then try again.';

/** Turns what the process printed into an answer, or the reason there is none. */
function readReply({ stdout, stderr, code }: ProcessOutput): EngineRunResult {
  const parsed = replySchema.safeParse(jsonReply(stdout));
  if (!parsed.success) {
    const detail = said(stderr);
    throw new EngineRunError(
      'failed',
      `Claude Code stopped without an answer (exit code ${String(code)})${detail ? `: ${detail}` : ''}`,
    );
  }
  const { subtype, is_error: isError, result, num_turns: turns } = parsed.data;
  if (!isError && subtype === 'success' && result !== undefined) {
    // A finished run with nothing written is not an answer to show.
    if (result.trim() === '') {
      throw new EngineRunError('failed', 'Claude finished without writing an answer.');
    }
    return { text: result, turns: turns ?? null };
  }
  const message = said(result ?? '');
  const kind = failureKind(message);
  if (kind === 'not-signed-in') throw new EngineRunError(kind, `${SIGN_IN_AGAIN} (${message})`);
  if (kind === 'limit') throw new EngineRunError(kind, message);
  if (subtype === 'error_max_turns') {
    throw new EngineRunError('failed', 'Claude ran out of steps before it finished. Try again.');
  }
  throw new EngineRunError('failed', message || 'Claude could not finish the analysis.');
}

/** Runs Claude Code once and resolves with its answer. Rejects with an EngineRunError. */
export async function runClaude(
  request: EngineRunRequest,
  deps: EngineDeps,
): Promise<EngineRunResult> {
  const output = await runProcess(
    {
      program: CLAUDE,
      args: buildClaudeArgs(request),
      cwd: request.cwd,
      timeoutMs: request.timeoutMs,
    },
    deps,
  );
  return readReply(output);
}

const knowsAuthStatus = (version: string | null): boolean => {
  const [major = 0, minor = 0] = (version ?? '').split('.').map(Number);
  const [sinceMajor, sinceMinor] = AUTH_STATUS_SINCE;
  return major > sinceMajor || (major === sinceMajor && minor >= sinceMinor);
};

/** Whether someone is signed in to Claude Code; null when it cannot be told. */
async function signedIn(version: string | null, deps: EngineDeps): Promise<boolean | null> {
  if (!knowsAuthStatus(version)) return null;
  const reply = await ask(CLAUDE, ['auth', 'status'], deps);
  if (reply instanceof EngineRunError) return null;
  // The reply also names the account; only whether there is one is kept.
  const parsed = authSchema.safeParse(jsonReply(reply.stdout));
  return parsed.success ? parsed.data.loggedIn : reply.code === 0;
}

async function checkClaude(deps: EngineDeps): Promise<EngineStatus> {
  const found = await installedVersion(CLAUDE, deps);
  return statusOf('claude', CLAUDE.label, {
    ...found,
    signedIn: found.installed ? await signedIn(found.version, deps) : null,
  });
}

export const claudeEngine: AnalysisEngine = {
  id: 'claude',
  label: CLAUDE.label,
  run: runClaude,
  check: checkClaude,
};
