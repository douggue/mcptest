/**
 * Starts one program, waits for it to finish and hands back what it printed.
 * Shared by every engine, so each is stopped the same way when it runs too
 * long, prints without end, or Jgtube is closing.
 */
import { spawn as nodeSpawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { cleanMessage } from '../jobs';
import { planLaunch } from './executable';
import { EngineRunError, notInstalled, withoutKeys } from './failure';
import type { EngineDeps, ProcessChild, Program, SpawnProcess } from './types';

const MAX_OUTPUT_CHARACTERS = 2_000_000;
/** A process asked to stop is given this long to go before it is forced. */
const KILL_GRACE_MS = 2000;

export interface ProcessRun {
  readonly program: Program;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly timeoutMs: number;
  /** Text for the program's input. A prompt sent this way never touches a command line. */
  readonly input?: string;
}

export interface ProcessOutput {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number | null;
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
function stopProcess(child: ProcessChild, graceMs: number): void {
  child.kill('SIGTERM');
  const force = setTimeout(() => child.kill('SIGKILL'), graceMs);
  // Waiting to force a process must not keep Jgtube itself from closing.
  force.unref();
  child.on('close', () => clearTimeout(force));
}

/** Whether a start-up error means the program is not there to run. */
const isMissingProgram = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'ENOENT';

const startFailure = (error: unknown, program: Program): EngineRunError =>
  isMissingProgram(error)
    ? notInstalled(program)
    : new EngineRunError('failed', `${program.label} could not be started: ${cleanMessage(error)}`);

const closingError = ({ name }: Program): EngineRunError =>
  new EngineRunError('failed', `${name} was stopped because Jgtube is closing.`);
const timeoutError = ({ name }: Program): EngineRunError =>
  new EngineRunError('timeout', `${name} took too long and was stopped. Try again.`);
const tooMuchError = ({ name }: Program): EngineRunError =>
  new EngineRunError('failed', `${name} sent more than could be read and was stopped.`);

/** Waits for a started process. Resolves with what it printed, whatever its exit code. */
function waitFor(child: ProcessChild, run: ProcessRun, deps: EngineDeps): Promise<ProcessOutput> {
  const { program } = run;
  return new Promise((resolve, reject) => {
    const output = collectText(MAX_OUTPUT_CHARACTERS);
    const errorText = collectText(MAX_OUTPUT_CHARACTERS);
    let settled = false;
    const settle = (finish: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      finish();
    };
    const stop = (error: EngineRunError): void =>
      settle(() => {
        stopProcess(child, deps.killGraceMs ?? KILL_GRACE_MS);
        reject(error);
      });
    const timer = setTimeout(() => stop(timeoutError(program)), run.timeoutMs);

    deps.signal?.addEventListener('abort', () => stop(closingError(program)), { once: true });

    // Once the verdict is in, whatever else the process prints is not kept.
    child.stdout.on('data', (chunk: unknown) => {
      if (!settled && output.add(chunk)) stop(tooMuchError(program));
    });
    child.stderr.on('data', (chunk: unknown) => {
      if (!settled) errorText.add(chunk);
    });
    child.on('error', (error: unknown) => settle(() => reject(startFailure(error, program))));
    child.on('close', (code: unknown) =>
      settle(() =>
        resolve({
          stdout: output.end(),
          stderr: errorText.end(),
          code: typeof code === 'number' ? code : null,
        }),
      ),
    );
  });
}

/**
 * Runs a program once with the owner's keys withheld. Rejects with an
 * EngineRunError when it cannot be found or started, runs past its time,
 * prints without end, or Jgtube is closing.
 */
export function runProcess(run: ProcessRun, deps: EngineDeps): Promise<ProcessOutput> {
  if (deps.signal?.aborted) return Promise.reject(closingError(run.program));
  let child: ProcessChild;
  try {
    const launch = planLaunch(run.program, run.args, deps);
    child = deps.spawn(launch.command, launch.args, {
      cwd: run.cwd,
      env: withoutKeys(deps.env),
      ...(run.input === undefined ? {} : { input: run.input }),
      ...(launch.verbatim ? { verbatim: true } : {}),
    });
  } catch (error) {
    return Promise.reject(
      error instanceof EngineRunError ? error : startFailure(error, run.program),
    );
  }
  return waitFor(child, run, deps);
}

/** Starts the real program. Its input is closed at once, or after the text meant for it. */
export const spawnProcess: SpawnProcess = (command, args, options) => {
  const child = nodeSpawn(command, [...args], {
    cwd: options.cwd,
    env: options.env as NodeJS.ProcessEnv,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    windowsVerbatimArguments: options.verbatim === true,
  });
  // A program that exits before reading its input must not bring Jgtube down.
  child.stdin.on('error', () => undefined);
  child.stdin.end(options.input);
  return {
    stdout: child.stdout,
    stderr: child.stderr,
    on: (event, listener) => child.on(event, listener as (...values: unknown[]) => void),
    kill: (signal) => child.kill(signal),
  };
};
