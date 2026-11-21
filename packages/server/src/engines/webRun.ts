/**
 * A web research run: an engine asked to look a subject up on the web, with
 * the web as its only tool. It never has Jgtube's connector or any other tool
 * server, and no file, shell or edit tool; it starts in a fresh private
 * folder, ignores the owner's settings, and the API keys in Jgtube's
 * environment are withheld from it. What goes into its question is fixed
 * text plus the owner's and a concept's words, quoted and capped.
 *
 * Only Claude Code is run this way: its built-in WebSearch and WebFetch tools
 * are the only tools the run has. The equivalents for Codex and Antigravity
 * below are written from their documentation and are UNPROVEN: no run of
 * them was made, so they are not in WEB_ENGINES and nothing calls them.
 */
import { readClaudeReply } from './claude';
import { runProcess } from './process';
import type { EngineDeps, EngineId, EngineRunResult, Program } from './types';

export interface WebRunRequest {
  readonly prompt: string;
  readonly systemPrompt: string;
  readonly maxTurns: number;
  readonly timeoutMs: number;
  /** A fresh private folder, so no project settings are picked up. */
  readonly cwd: string;
}

/** The engines a web research run is really asked of. */
export const WEB_ENGINES: readonly EngineId[] = ['claude'];
/** Claude Code's built-in web tools: the only tools a web research run has. */
export const WEB_TOOLS: readonly string[] = ['WebSearch', 'WebFetch'];
/** Every other built-in tool, denied as a second lock. */
const DENIED: readonly string[] = [
  'Bash',
  'Edit',
  'Write',
  'Read',
  'Glob',
  'Grep',
  'NotebookEdit',
  'Agent',
  'Task',
  'TodoWrite',
];

const CLAUDE: Program = { command: 'claude', label: 'Claude Code', name: 'Claude' };

/** The command line for one web research run of Claude Code. The prompt is an argument. */
export function buildClaudeWebArgs(request: WebRunRequest): readonly string[] {
  return [
    '-p',
    request.prompt,
    '--output-format',
    'json',
    '--max-turns',
    String(request.maxTurns),
    '--system-prompt',
    request.systemPrompt,
    // No tool server at all: not Jgtube's, not the owner's.
    '--strict-mcp-config',
    '--mcp-config',
    JSON.stringify({ mcpServers: {} }),
    '--setting-sources',
    'project',
    '--permission-mode',
    'dontAsk',
    '--tools',
    WEB_TOOLS.join(','),
    '--allowedTools',
    ...WEB_TOOLS,
    '--disallowedTools',
    ...DENIED,
  ];
}

/** Runs Claude Code once with only the web; resolves with its answer. Rejects with an EngineRunError. */
export async function runClaudeWeb(
  request: WebRunRequest,
  deps: EngineDeps,
): Promise<EngineRunResult> {
  const output = await runProcess(
    {
      program: CLAUDE,
      args: buildClaudeWebArgs(request),
      cwd: request.cwd,
      timeoutMs: request.timeoutMs,
    },
    deps,
  );
  return readClaudeReply(output);
}

/**
 * UNPROVEN, from Codex CLI's documentation: `exec` in a read-only sandbox,
 * with no tool servers and the live web search tool switched on. Not run.
 */
export function buildCodexWebArgs(request: WebRunRequest): readonly string[] {
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
    '-c',
    'web_search="live"',
    '-c',
    'features.shell_tool=false',
    '-c',
    'mcp_servers={}',
    '-',
  ];
}

/**
 * UNPROVEN, from Antigravity CLI's documentation: a headless run in its
 * sandbox. It cannot be told to drop the owner's own tool servers or to allow
 * only web reading, so it does not meet the box above; it is written down
 * only to say so, and is never used.
 */
export function buildAgyWebArgs(request: WebRunRequest): readonly string[] {
  return [
    '-p',
    `${request.systemPrompt}\n\n${request.prompt}`,
    '--output-format',
    'json',
    '--sandbox',
  ];
}
