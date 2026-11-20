import { beatsItsChannel } from '../niches/outperform';
import type { Place } from './places';
import type { TransferVerdict, TransferVersion } from './types';

/**
 * Decides whether an idea is a transfer opportunity for the owner: it took
 * off somewhere else, and the owner's place has no version of it or only a
 * weak one.
 */

/**
 * A version made for the owner's place is weak when its views are under this
 * share of the best version elsewhere. A tenth is an order of magnitude:
 * channels of different sizes making the same video ordinarily land within a
 * few times of each other, so ten times less is the version failing, not the
 * channel being smaller.
 */
export const TRANSFER_WEAK_MAX_SHARE = 0.1;

/**
 * Whether a version took off: widely seen, and far above its channel's usual
 * views or its size. It is the niche list's rule for an outperforming video
 * without its 30-day limit, since every video considered here is already
 * inside the transfer window.
 */
export function isStrong(views: number, score: number | null, subscribers: number | null): boolean {
  return beatsItsChannel(views, score, subscribers);
}

const mostViewed = (versions: readonly TransferVersion[]): TransferVersion | null =>
  versions.reduce<TransferVersion | null>(
    (best, version) => (best === null || version.views > best.views ? version : best),
    null,
  );

/**
 * The verdict on one idea's versions for the owner's place.
 *
 * A version's place is the one its title names or, failing that, its
 * channel's country; the rule is the same either way. A version with no known
 * place may be the owner's, so an idea is never called open while one exists.
 */
export function judge(
  versions: readonly TransferVersion[],
  ownerPlace: Place | null,
): TransferVerdict {
  const placed = versions.filter((version) => version.place !== null);
  const unplaced = versions.filter((version) => version.place === null);
  const own = placed.filter((version) => version.place?.key === ownerPlace?.key);
  const elsewhere = placed.filter((version) => version.place?.key !== ownerPlace?.key);
  const winner = mostViewed(elsewhere.filter((version) => version.strong));
  const ownBest = ownerPlace ? mostViewed(own) : null;

  if (ownerPlace === null) return { status: 'unplaced', winner, own: null };
  if (own.some((version) => version.strong)) return { status: 'done', winner, own: ownBest };
  if (winner === null) {
    const status = unplaced.some((version) => version.strong) ? 'unplaced' : 'unproven';
    return { status, winner, own: ownBest };
  }
  if (ownBest !== null) {
    const weak = ownBest.views < winner.views * TRANSFER_WEAK_MAX_SHARE;
    return { status: weak ? 'weak' : 'done', winner, own: ownBest };
  }
  return { status: unplaced.length > 0 ? 'unplaced' : 'open', winner, own: null };
}
