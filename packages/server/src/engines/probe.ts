/**
 * Questions a program answers about itself without spending any allowance:
 * whether it is there, and which version it is.
 */
import { tmpdir } from 'node:os';
import { cleanMessage } from '../jobs';
import { EngineRunError } from './failure';
import { runProcess, type ProcessOutput } from './process';
import type { EngineDeps, EngineStatus, Program } from './types';

/** A program asked for its version answers at once; one that has not after this long is stuck. */
const CHECK_TIMEOUT_MS = 15_000;
const VERSION = /\d+\.\d+\.\d+(?:[-+][\w.]+)?/;

/** Runs a program with a few fixed arguments. Never rejects: a failure comes back as a value. */
export async function ask(
  program: Program,
  args: readonly string[],
  deps: EngineDeps,
): Promise<ProcessOutput | EngineRunError> {
  try {
    // Started away from the Jgtube folder, so no project settings are picked up.
    return await runProcess({ program, args, cwd: tmpdir(), timeoutMs: CHECK_TIMEOUT_MS }, deps);
  } catch (error) {
    return error instanceof EngineRunError
      ? error
      : new EngineRunError('failed', cleanMessage(error));
  }
}

export interface Installed {
  readonly installed: boolean;
  readonly version: string | null;
}

/** Whether the program can be started, and the version it reports when it reports one. */
export async function installedVersion(program: Program, deps: EngineDeps): Promise<Installed> {
  const reply = await ask(program, ['--version'], deps);
  if (reply instanceof EngineRunError) {
    return { installed: reply.reason !== 'not-installed', version: null };
  }
  return {
    installed: true,
    version: VERSION.exec(`${reply.stdout}\n${reply.stderr}`)?.[0] ?? null,
  };
}

export interface StatusFacts extends Installed {
  readonly signedIn: boolean | null;
  /** What stops Jgtube using it although it is installed and signed in, in one sentence. */
  readonly blockedBy?: string | null;
  /** Something worth knowing that does not stop it. */
  readonly remark?: string | null;
}

/** The status of one engine, with the one sentence that most needs saying. */
export function statusOf(id: EngineStatus['id'], label: string, facts: StatusFacts): EngineStatus {
  const { installed, version, signedIn } = facts;
  const blockedBy = installed ? (facts.blockedBy ?? null) : null;
  return {
    id,
    label,
    installed,
    signedIn: installed ? signedIn : null,
    version,
    ready: installed && signedIn !== false && blockedBy === null,
    note: blockedBy ?? (installed ? (facts.remark ?? null) : null),
  };
}
