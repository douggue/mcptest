import type { MapSnapshot } from '../map/snapshot';
import type { BrandRepo } from '../repos/types';
import type { ChannelBrand, YouTubeSource } from '../sources/types';
import { LOGO_SHOWN_MIN_WIDTH, pickImage } from './brand';

/**
 * Logos for a map whose channels were read before logos were stored.
 *
 * A channel's logo is kept when the channel is read, so a map made earlier
 * shows initials until each channel is read again. This reads only the
 * channel page (one request each, no videos) for the channels of one map that
 * have never had their branding read, and stores what the page shows.
 */

/** The most channels one run asks YouTube about: about a minute of gentle reading. */
export const LOGO_BACKFILL_MAX_CHANNELS = 60;
/** This many channels in a row that cannot be read means YouTube is refusing; the run stops. */
export const LOGO_BACKFILL_MAX_FAILURES_IN_A_ROW = 3;

/** What a channel page with no readable branding is stored as, so it is not asked for again. */
const NO_BRAND: ChannelBrand = {
  description: null,
  avatar: [],
  banner: [],
  keywords: [],
  links: [],
};

export interface LogoFound {
  readonly channelId: string;
  /** Null when the channel's page showed no logo. */
  readonly logoUrl: string | null;
}

export interface LogoProgress {
  readonly done: number;
  readonly total: number;
  /** Every channel read so far in this run, with its logo. */
  readonly logos: readonly LogoFound[];
}

export interface LogoOutcome {
  /** Channels YouTube was asked about. */
  readonly asked: number;
  /** Of those, how many showed a logo. */
  readonly found: number;
  readonly failed: number;
  /** True when the run ended before its list did: told to stop, or refused several times in a row. */
  readonly stoppedEarly: boolean;
}

export interface LogoBackfillDeps {
  readonly brands: BrandRepo;
  readonly source: Pick<YouTubeSource, 'fetchChannel'>;
  readonly now: () => Date;
}

export interface LogoBackfillOptions {
  readonly onProgress?: (progress: LogoProgress) => void;
  /** Asked before each channel; true ends the run there. */
  readonly shouldStop?: () => boolean;
}

/**
 * The channels of a map whose branding was never read: the centre, then the
 * look-alikes the owner still counts, then every other channel, each group in
 * the map's own order.
 */
export function channelsMissingLogos(
  snapshot: Pick<MapSnapshot, 'center' | 'channels'>,
  brands: Pick<BrandRepo, 'find'>,
): readonly string[] {
  const shown = snapshot.channels.filter((channel) => channel.peer && !channel.removed);
  const rest = snapshot.channels.filter((channel) => !channel.peer || channel.removed);
  const ordered = [snapshot.center.id, ...[...shown, ...rest].map((channel) => channel.id)];
  return [...new Set(ordered)].filter((channelId) => brands.find(channelId) === null);
}

/**
 * Reads the page of each channel, one after another, and stores its branding.
 * A channel that cannot be read is passed over; several in a row end the run.
 */
export async function backfillLogos(
  deps: LogoBackfillDeps,
  channelIds: readonly string[],
  options: LogoBackfillOptions = {},
): Promise<LogoOutcome> {
  let logos: readonly LogoFound[] = [];
  let failed = 0;
  let failuresInARow = 0;
  let asked = 0;
  for (const channelId of channelIds) {
    if (options.shouldStop?.() || failuresInARow >= LOGO_BACKFILL_MAX_FAILURES_IN_A_ROW) break;
    asked += 1;
    try {
      // No videos are asked for: the page itself carries the logo.
      const page = await deps.source.fetchChannel(channelId, 0);
      const brand = page.brand ?? NO_BRAND;
      deps.brands.save(channelId, brand, deps.now());
      const logoUrl = pickImage(brand.avatar, LOGO_SHOWN_MIN_WIDTH)?.url ?? null;
      logos = [...logos, { channelId, logoUrl }];
      failuresInARow = 0;
    } catch {
      failed += 1;
      failuresInARow += 1;
    }
    options.onProgress?.({ done: asked, total: channelIds.length, logos });
  }
  return {
    asked,
    found: logos.filter((logo) => logo.logoUrl !== null).length,
    failed,
    stoppedEarly: asked < channelIds.length,
  };
}
