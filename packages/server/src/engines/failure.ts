import { cleanMessage } from '../jobs';
import type { AnyEngineId, EngineFailure, Program } from './types';

/** An engine that was passed over, and the reason in plain words. */
export interface SkippedEngine {
  readonly engine: AnyEngineId;
  readonly reason: EngineFailure;
  readonly message: string;
}

export class EngineRunError extends Error {
  constructor(
    readonly reason: EngineFailure,
    message: string,
    /** The engines passed over before this failure, when several were tried. */
    readonly skipped: readonly SkippedEngine[] = [],
  ) {
    super(message);
    this.name = 'EngineRunError';
  }
}

export const notInstalled = ({ label }: Program): EngineRunError =>
  new EngineRunError(
    'not-installed',
    `${label} is not installed on this computer, or cannot be found. Install it and sign in, then try again.`,
  );

/**
 * Never handed to an engine. With a key in its environment a program bills
 * that key instead of using the owner's login (`ANTHROPIC_API_KEY` for Claude
 * Code, `CODEX_API_KEY` and `OPENAI_API_KEY` for Codex, `GEMINI_API_KEY` and
 * `GOOGLE_API_KEY` for Antigravity), and no run has any use for the others.
 */
export const WITHHELD_ENV: readonly string[] = [
  'ANTHROPIC_API_KEY',
  'CODEX_API_KEY',
  'OPENAI_API_KEY',
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'YOUTUBE_API_KEY',
];

export function withoutKeys(
  env: Readonly<Record<string, string | undefined>>,
): Record<string, string | undefined> {
  return Object.fromEntries(Object.entries(env).filter(([name]) => !WITHHELD_ENV.includes(name)));
}

const MAX_ERROR_DETAIL = 300;
/** How the three programs word "your plan has no capacity left for now". */
const LIMIT_PATTERN =
  /hit your .*limit|usage limit|rate limit|quota|too many requests|resource.?exhausted/i;
/** How they word "nobody is signed in". */
const SIGN_IN_PATTERN =
  /authentication required|not (?:logged|signed) in|please run \/login|log ?in required|unauthori[sz]ed/i;
const TIMEOUT_PATTERN = /timed? ?out|deadline exceeded/i;

/** What a program said, safe to show: no control characters, no file paths, not too long. */
export const said = (text: string): string => cleanMessage(text).trim().slice(0, MAX_ERROR_DETAIL);

/**
 * The kind of failure a program's own words describe. Anything that does not
 * read as a plan limit, a missing sign-in or a timeout is a plain failure.
 */
export function failureKind(message: string): EngineFailure {
  if (LIMIT_PATTERN.test(message)) return 'limit';
  if (SIGN_IN_PATTERN.test(message)) return 'not-signed-in';
  return TIMEOUT_PATTERN.test(message) ? 'timeout' : 'failed';
}

/** The first server and tool of a full tool name such as `mcp__jgtube__get_map`. */
const TOOL_NAME = /^mcp__([A-Za-z0-9_-]+?)__([A-Za-z0-9_-]+)$/;

/**
 * The allowed tools of one server, by their bare names. Engines other than
 * Claude Code name a tool by its server and its own name, not by one string.
 */
export function toolsOf(server: string, allowedTools: readonly string[]): readonly string[] {
  return allowedTools.flatMap((name) => {
    const match = TOOL_NAME.exec(name);
    return match && match[1] === server && match[2] ? [match[2]] : [];
  });
}

/**
 * For engines with no place for a system prompt: it goes ahead of the
 * question. `between` is a blank line unless the text must stay on one line.
 */
export const promptWithInstructions = (
  systemPrompt: string,
  prompt: string,
  between = '\n\n',
): string => `${systemPrompt}${between}${prompt}`;
