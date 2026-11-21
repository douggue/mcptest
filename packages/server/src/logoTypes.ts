import type { LogoOutcome, LogoProgress } from '@jgtube/core';

/** The part of the engine that fills in logos for a map made before logos were stored. */
export interface LogoEngine {
  /**
   * The channels of a channel's latest map whose branding was never read, the
   * centre and the look-alikes first, no more than one run reads. Null when
   * the channel has no map; reads the store only.
   */
  missingLogos(channel: string): readonly string[] | null;
  /**
   * Reads the page of each channel and stores its logo, while holding the
   * right to read YouTube. Rejects, having read nothing, when other work holds it.
   */
  fetchLogos(
    channelIds: readonly string[],
    onProgress: (progress: LogoProgress) => void,
    shouldStop: () => boolean,
  ): Promise<LogoOutcome>;
}
