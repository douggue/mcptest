/** Length and pacing against the winners, as the API sees it: one centre channel and its map. */
import type { PacingView } from '@jgtube/core';

export interface PacingEngine {
  /** Reads the store only; null when the channel has no map. */
  findPacing(centerChannelId: string): PacingView | null;
}
