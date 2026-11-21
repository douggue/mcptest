import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { EngineRunResult } from './engines/types';
import type { WebRunRequest } from './engines/webRun';

type WebRun = (request: WebRunRequest) => Promise<EngineRunResult>;

/**
 * A web research run that starts in a fresh, empty folder of its own, made
 * for the run and removed after it, however it ends: no project settings,
 * no files of the owner's and nothing from an earlier run are there.
 */
export function inPrivateFolder(run: WebRun): WebRun {
  return async (request) => {
    const folder = await mkdtemp(join(tmpdir(), 'jgtube-web-'));
    try {
      return await run({ ...request, cwd: folder });
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  };
}
