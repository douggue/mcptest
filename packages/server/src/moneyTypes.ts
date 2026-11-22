/** The public signs of channels' earning, as the API sees them: channels by their ids. */
import type { MoneyCheckOutcome, MoneyVerdict } from '@jgtube/core';

export interface MoneyEngine {
  /** The verdicts of the stored channels among the ids; reads the store only. */
  findMoney(channelIds: readonly string[]): readonly MoneyVerdict[];
  /**
   * Reads one watch page for each channel (at most ten) while holding the
   * right to read YouTube, and stores what it shows. Rejects, having read
   * nothing, when other work holds that right.
   */
  checkMoney(channelIds: readonly string[]): Promise<MoneyCheckOutcome>;
}
