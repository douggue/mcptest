/** Length and pacing against the winners for one centre channel, read from the store only. */
import { loadPacing, type PacingDeps } from '@jgtube/core';
import type { PacingEngine } from './pacingTypes';

export interface PacingEngineDeps {
  readonly now: () => Date;
  readonly repos: PacingDeps;
}

export function pacingEngine({ now, repos }: PacingEngineDeps): PacingEngine {
  return { findPacing: (center) => loadPacing(repos, center, now()) };
}
