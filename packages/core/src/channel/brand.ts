import { ingestChannel, type IngestDeps } from '../ingest';
import type { BrandRepo, StoredBrand, StoredChannel } from '../repos/types';
import { parseChannelRef } from '../sources/parse';
import type { BrandImage } from '../sources/types';

/**
 * How a channel presents itself: logo, cover, bio, keywords and header links.
 * It is read from the channel page every ingest already fetches, so a channel
 * read since this was added has it stored; an older one is read again once.
 */

/**
 * The narrowest logo worth showing beside a channel's name: the page draws it
 * 32 pixels wide, and a sharp screen uses two picture pixels for each.
 */
export const LOGO_SHOWN_MIN_WIDTH = 64;
/** A logo to be looked at closely: wide enough to read its lettering. */
export const LOGO_VIEWED_MIN_WIDTH = 256;
/** A cover to be looked at closely: wide enough to read the words on it, well under full size. */
export const COVER_VIEWED_MIN_WIDTH = 1000;

/** The smallest picture at least `minWidth` wide, else the widest there is; null when there is none. */
export function pickImage(images: readonly BrandImage[], minWidth: number): BrandImage | null {
  const byWidth = [...images].sort((a, b) => a.width - b.width);
  return byWidth.find((image) => image.width >= minWidth) ?? byWidth.at(-1) ?? null;
}

export interface BrandDeps extends IngestDeps {
  readonly brands: BrandRepo;
}

export interface BrandResult {
  readonly channel: StoredChannel;
  /** Null when the channel's page gave nothing to read it from. */
  readonly brand: StoredBrand | null;
  /** True when nothing was asked of YouTube. */
  readonly fromStore: boolean;
}

/**
 * A channel's branding: the stored copy when there is one, otherwise the
 * channel is read again (which also brings its videos up to date) and what
 * its page shows is stored. `channel` is a handle, a channel id or a link.
 */
export async function readChannelBrand(deps: BrandDeps, channel: string): Promise<BrandResult> {
  const ref = parseChannelRef(channel);
  const known =
    ref.kind === 'id' ? deps.channels.findById(ref.id) : deps.channels.findByHandle(ref.handle);
  const stored = known ? deps.brands.find(known.id) : null;
  if (known && stored) return { channel: known, brand: stored, fromStore: true };
  const read = await ingestChannel(deps, channel, { refresh: true });
  return { channel: read.channel, brand: deps.brands.find(read.channel.id), fromStore: false };
}
