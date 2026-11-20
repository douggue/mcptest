import { EventEmitter } from 'node:events';
import type { EngineDeps, ProcessChild, SpawnOptions, SpawnProcess } from '../../src/engines/types';

/** A stand-in for a program's process that the test drives by hand. */
export class FakeChild extends EventEmitter implements ProcessChild {
  readonly stdout = new EventEmitter();
  readonly stderr = new EventEmitter();
  killed = false;
  /** The signal of each request to stop, in order. */
  signals: Array<string | undefined> = [];

  kill(signal?: string): void {
    this.killed = true;
    this.signals.push(signal);
  }

  finish(output: unknown, code = 0, errorText = ''): void {
    if (output !== undefined) {
      this.stdout.emit('data', typeof output === 'string' ? output : JSON.stringify(output));
    }
    if (errorText) this.stderr.emit('data', errorText);
    this.emit('close', code);
  }
}

export interface Started extends SpawnOptions {
  readonly command: string;
  readonly args: readonly string[];
}

/** One process a test starts and finishes by hand. */
export function harness(env: Record<string, string | undefined> = { PATH: '/bin' }) {
  const child = new FakeChild();
  const started: Started[] = [];
  const spawn: SpawnProcess = (command, args, options) => {
    started.push({ command, args, ...options });
    return child;
  };
  const deps: EngineDeps = { spawn, env, platform: 'linux' };
  return { child, started, deps };
}

export interface Scripted {
  readonly stdout?: string;
  readonly stderr?: string;
  readonly code?: number;
  /** Fails to start with this error code, such as ENOENT. */
  readonly startError?: string;
}

/**
 * Stand-in programs that answer by themselves: each start is handed to
 * `script`, which says what that process prints and how it exits.
 */
export function scripted(
  script: (start: Started) => Scripted,
  env: Record<string, string | undefined> = { PATH: '/bin' },
) {
  const started: Started[] = [];
  const spawn: SpawnProcess = (command, args, options) => {
    const start: Started = { command, args, ...options };
    started.push(start);
    const child = new FakeChild();
    const reply = script(start);
    queueMicrotask(() => {
      if (reply.startError !== undefined) {
        child.emit('error', Object.assign(new Error('spawn failed'), { code: reply.startError }));
        return;
      }
      child.finish(reply.stdout, reply.code ?? 0, reply.stderr ?? '');
    });
    return child;
  };
  const deps: EngineDeps = { spawn, env, platform: 'linux' };
  return { started, deps };
}

export const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** One MP4 box: its length, its four-letter name and what it holds. */
export function box(name: string, body = ''): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(8 + Buffer.byteLength(body), 0);
  header.write(name, 4, 'latin1');
  return Buffer.concat([header, Buffer.from(body)]);
}

/** A stand-in video: the smallest file with the outline of a whole MP4. Nothing could play it. */
export const tinyMp4 = (): Buffer =>
  Buffer.concat([box('ftyp', 'isom'), box('moov'), box('mdat', 'not really a video')]);
