import {
  LOGO_BACKFILL_MAX_CHANNELS,
  backfillLogos,
  channelsMissingLogos,
  type BrandRepo,
  type MapSnapshot,
  type YouTubeSource,
} from '@jgtube/core';
import type { LogoEngine } from './logoTypes';

export interface LogoWiring {
  readonly repos: { readonly brands: BrandRepo };
  readonly now: () => Date;
  /** A source that connects on first use. */
  readonly lazySource: Pick<YouTubeSource, 'fetchChannel'>;
  /** Runs work while holding the right to read YouTube. */
  readonly reading: <T>(work: () => Promise<T>) => Promise<T>;
  readonly findSnapshot: (channel: string) => MapSnapshot | null;
}

/** Logos for the channels of a map that were read before logos were stored. */
export function logos(wiring: LogoWiring): LogoEngine {
  const { repos, now, lazySource, reading, findSnapshot } = wiring;
  return {
    missingLogos(channel) {
      const snapshot = findSnapshot(channel);
      if (!snapshot) return null;
      return channelsMissingLogos(snapshot, repos.brands).slice(0, LOGO_BACKFILL_MAX_CHANNELS);
    },

    fetchLogos(channelIds, onProgress, shouldStop) {
      return reading(() =>
        backfillLogos({ brands: repos.brands, source: lazySource, now }, channelIds, {
          onProgress,
          shouldStop,
        }),
      );
    },
  };
}
