/**
 * A rough range for what a Short's views are worth in ad revenue.
 *
 * It is an estimate from the owner's own figures, not a measurement: the tool
 * cannot see whether a channel is monetised, where its viewers live or how
 * long they watch, and those move the real figure several times over. The
 * range is deliberately wide and is meant for comparing findings, not for
 * predicting a payout.
 *
 * Every view is valued at the Shorts rate. Telling a Short from an ordinary
 * video is the Shorts check's work, done before a video gets here.
 */

export interface RateRange {
  /** US dollars per 1,000 views. */
  readonly low: number;
  readonly high: number;
}

/**
 * Shorts are paid from a shared pool and earn a fraction of a long video's rate
 * per view. The range is the owner's own figures for their kind of channel.
 */
export const SHORTS_RATE: RateRange = { low: 0.1, high: 0.5 };
/** YouTube pays for ads only once a channel has this many subscribers (and enough views). */
export const MIN_SUBSCRIBERS_FOR_ADS = 1000;

const VIEWS_PER_RATE_UNIT = 1000;
const CENTS_PER_DOLLAR = 100;

export interface EarningsEstimate {
  /** US dollars, to the cent. */
  readonly low: number;
  readonly high: number;
  readonly views: number;
  /**
   * True when the channel is too small to be paid for ads yet, so the range is
   * what the views would be worth, not what was earned. Null when the
   * subscriber count is hidden.
   */
  readonly belowAdThreshold: boolean | null;
}

const toCents = (dollars: number): number =>
  Math.round(dollars * CENTS_PER_DOLLAR) / CENTS_PER_DOLLAR;

/** The ad revenue range for a number of Shorts views. */
export function estimateShortsEarnings(
  views: number,
  subscribers: number | null,
  rate: RateRange = SHORTS_RATE,
): EarningsEstimate {
  if (!Number.isFinite(views) || views < 0) {
    throw new RangeError('A view count must be zero or more');
  }
  const worth = (perThousand: number): number =>
    toCents((views / VIEWS_PER_RATE_UNIT) * perThousand);
  return {
    low: worth(rate.low),
    high: worth(rate.high),
    views,
    belowAdThreshold: subscribers === null ? null : subscribers < MIN_SUBSCRIBERS_FOR_ADS,
  };
}
