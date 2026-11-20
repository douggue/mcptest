/**
 * Reads what one headless `agy` run printed. Every assumption about its
 * output is here.
 *
 * Documented (v1.5.12, headless mode): with `--output-format json` it prints
 * one object with `status` (`SUCCESS`, `ERROR`, `CANCELED`, ...), `response`,
 * `num_turns`, `usage`, and `error` on failure. A run with no saved sign-in
 * ends with "authentication required". A tool the run could not get approval
 * for is refused quietly: the run goes on, exits 0 and prints a notice to its
 * error output, whose wording is not documented.
 *
 * Not in the documentation read, but reported for the same version and so
 * accepted when present: a `denied_actions` list in the object, and an
 * `AGY_ERROR: {json}` line on the error output when a run ends badly.
 */
import { z } from 'zod';
import { EngineRunError, failureKind, said } from './failure';
import type { ProcessOutput } from './process';
import type { EngineRunResult } from './types';

const SUCCESS = 'SUCCESS';
const NOT_SIGNED_IN =
  'Nobody is signed in to Antigravity CLI. Open a terminal, type "agy" and sign in, then try again.';
const ERROR_LINE = /^AGY_ERROR:\s*(.+)$/m;
/** How a notice about a refused action is taken to read. */
const DENIAL = /denied|not permitted|permission/i;
/** How a refused action is taken to name a tool from a tool server. */
const NAMES_MCP = /\bmcp\b|mcp_|call_mcp_tool/i;

/** The line the owner has to add, and where. Shown when the tools are not allowed. */
export const permissionHelp = (server: string): string =>
  `Antigravity CLI may not use Jgtube's tools yet. In your home folder open .gemini, then antigravity-cli, then settings.json, and add "mcp(${server}/*)" to the "allow" list under "permissions" (the README shows the lines). Then try again.`;

const replySchema = z.object({
  status: z.string().optional(),
  response: z.string().optional(),
  error: z.unknown().optional(),
  denied_actions: z.array(z.unknown()).optional(),
  num_turns: z.number().optional(),
});
type AgyReply = z.infer<typeof replySchema>;

const messageSchema = z.object({ message: z.string() });

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** An error as text, whether it came as a string or as an object with a message. */
function errorText(error: unknown): string {
  if (typeof error === 'string') return error;
  const withMessage = messageSchema.safeParse(error);
  if (withMessage.success) return withMessage.data.message;
  return error === undefined || error === null ? '' : JSON.stringify(error);
}

/** What the run said went wrong: from its reply, else its error line, else its error output. */
function problemOf(reply: AgyReply | null, stderr: string): string {
  const fromReply = errorText(reply?.error);
  if (fromReply !== '') return fromReply;
  const line = ERROR_LINE.exec(stderr)?.[1];
  if (line === undefined) return stderr;
  return errorText(parseJson(line) ?? line);
}

/** Whether the run was refused one of the tools it was given. */
function refusedTools(reply: AgyReply, stderr: string, servers: readonly string[]): boolean {
  const listed = reply.denied_actions?.length ? JSON.stringify(reply.denied_actions) : '';
  const notices = stderr.split('\n').filter((line) => DENIAL.test(line));
  const refused = [listed, ...notices].join('\n');
  return servers.some((name) => refused.includes(name)) || NAMES_MCP.test(refused);
}

function failure(reply: AgyReply | null, { stderr, code }: ProcessOutput): EngineRunError {
  const problem = said(problemOf(reply, stderr));
  const kind = failureKind(problem);
  if (kind === 'not-signed-in') return new EngineRunError(kind, NOT_SIGNED_IN);
  if (problem !== '') return new EngineRunError(kind, problem);
  const how =
    reply?.status && reply.status !== SUCCESS
      ? `status ${reply.status}`
      : `exit code ${String(code)}`;
  return new EngineRunError('failed', `Antigravity CLI stopped without an answer (${how})`);
}

/**
 * Turns what `agy` printed into an answer, or the reason there is none.
 * `servers` are the tool servers the run was given: a run that was refused
 * their tools has answered from nothing, and that is a failure.
 */
export function readAgyReply(output: ProcessOutput, servers: readonly string[]): EngineRunResult {
  const parsed = replySchema.safeParse(parseJson(output.stdout));
  const reply = parsed.success ? parsed.data : null;
  const succeeded =
    reply !== null &&
    output.code === 0 &&
    (reply.status ?? SUCCESS) === SUCCESS &&
    !!reply.response;
  if (!succeeded) throw failure(reply, output);
  const [server] = servers;
  if (server !== undefined && refusedTools(reply, output.stderr, servers)) {
    throw new EngineRunError('failed', permissionHelp(server));
  }
  return { text: reply.response ?? '', turns: reply.num_turns ?? null };
}
