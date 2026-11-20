/**
 * A rough range for what a Short's views are worth in ad revenue.
 *
 * It is an estimate from a rate range, not a measurement: the tool cannot see
 * whether a channel is monetised, where its viewers live or how long they
 * watch, and those move the real figure several times over. The range is
 * deliberately wide and is meant for comparing findings, not for predicting
 * a payout.
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
 * per view. This is the range used when the settings give none
 * (SHORTS_RATE_LOW and SHORTS_RATE_HIGH); it is wide on purpose and describes
 * no channel or subject in particular.
 */
export const DEFAULT_SHORTS_RATE: RateRange = { low: 0.1, high: 0.5 };
/**
 * The subscriber count below which a channel is flagged. YouTube's partner
 * programme asks for this many among other conditions the tool cannot see, so
 * the flag says only which side of the number a channel is on, not whether it is paid.
 */
export const SUBSCRIBER_THRESHOLD = 1000;

const VIEWS_PER_RATE_UNIT = 1000;
const CENTS_PER_DOLLAR = 100;

export interface EarningsEstimate {
  /** US dollars, to the cent. */
  readonly low: number;
  readonly high: number;
  readonly views: number;
  /**
   * True when the channel has fewer subscribers than the threshold. The range
   * is what the views would be worth at the rate either way, never what was
   * earned. Null when the subscriber count is hidden.
   */
  readonly belowSubscriberThreshold: boolean | null;
}

const toCents = (dollars: number): number =>
  Math.round(dollars * CENTS_PER_DOLLAR) / CENTS_PER_DOLLAR;

/** The ad revenue range for a number of Shorts views. */
export function estimateShortsEarnings(
  views: number,
  subscribers: number | null,
  rate: RateRange = DEFAULT_SHORTS_RATE,
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
    belowSubscriberThreshold: subscribers === null ? null : subscribers < SUBSCRIBER_THRESHOLD,
  };
}
