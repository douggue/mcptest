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
  'GOOGLE_GENAI_API_KEY',
  'YOUTUBE_API_KEY',
  'GH_TOKEN',
  'GITHUB_TOKEN',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
];

/** The environment without the withheld names, however they are capitalised (Windows ignores case). */
export function withoutKeys(
  env: Readonly<Record<string, string | undefined>>,
): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(env).filter(([name]) => !WITHHELD_ENV.includes(name.toUpperCase())),
  );
}

const MAX_ERROR_DETAIL = 300;
/** How the three programs word "your plan has no capacity left for now". */
const LIMIT_PATTERN =
  /hit your .*limit|usage limit|rate limit|quota|too many requests|resource.?exhausted|\b(?:\d+-hour|hourly|daily|weekly|monthly|session) limit\b|limit (?:has been )?reached|credit balance/i;
/**
 * How they word "nobody is signed in". Their own wording only: "unauthorized"
 * counts at the start of what a program said, not further in, where it is
 * what a tool reports when a website turns it away.
 */
const SIGN_IN_PATTERN =
  /authentication required|authentication_error|not (?:logged|signed) in|please run \/login|log ?in required|oauth token (?:has )?expired|invalid api key|^(?:\d{3} )?unauthori[sz]ed/i;
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

function parsed(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * The JSON reply in what a program printed: the whole of it, or, when a
 * notice was printed ahead of the reply, the last line that is a JSON object.
 * Null when there is none.
 */
export function jsonReply(stdout: string): unknown {
  const whole = parsed(stdout);
  if (whole !== undefined) return whole;
  const lines = stdout.split('\n').map((line) => line.trim());
  const reply = lines.findLast((line) => line.startsWith('{') && parsed(line) !== undefined);
  return reply === undefined ? null : parsed(reply);
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
