/**
 * A rough range for what a set of views is worth in ad revenue.
 *
 * It is an estimate from public rules of thumb, not a measurement: the tool
 * cannot see whether a channel is monetised, where its viewers live or how
 * long they watch, and those move the real figure several times over. The
 * range is deliberately wide and is meant for comparing channels, not for
 * predicting a payout.
 */

export interface RateRange {
  /** US dollars per 1,000 views. */
  readonly low: number;
  readonly high: number;
}

export interface EarningsRates {
  readonly longForm: RateRange;
  readonly shorts: RateRange;
}

/** Commonly quoted creator earnings for long English-language explainer videos. */
export const LONG_FORM_RATE: RateRange = { low: 2, high: 8 };
/**
 * Shorts are paid from a shared pool and earn a fraction of a long video's rate
 * per view. The range is the owner's own figures for their kind of channel.
 */
export const SHORTS_RATE: RateRange = { low: 0.1, high: 0.5 };
/**
 * Videos this short are counted as Shorts. Shorts may now run longer, but a
 * longer video cannot be told from an ordinary one without its shape, so only
 * the unambiguous ones are counted at the Shorts rate.
 */
export const SHORTS_MAX_SECONDS = 60;
/** YouTube pays for ads only once a channel has this many subscribers (and enough watch time). */
export const MIN_SUBSCRIBERS_FOR_ADS = 1000;

const DEFAULT_RATES: EarningsRates = { longForm: LONG_FORM_RATE, shorts: SHORTS_RATE };
const VIEWS_PER_RATE_UNIT = 1000;

export interface EarningsVideo {
  readonly views: number;
  readonly durationSeconds: number | null;
}

export interface EarningsEstimate {
  /** Whole US dollars. */
  readonly low: number;
  readonly high: number;
  readonly longFormViews: number;
  readonly shortsViews: number;
  /**
   * True when the channel is too small to be paid for ads yet, so the range is
   * what the views would be worth, not what was earned. Null when the
   * subscriber count is hidden.
   */
  readonly belowAdThreshold: boolean | null;
}

const isShort = (video: EarningsVideo): boolean =>
  video.durationSeconds !== null && video.durationSeconds <= SHORTS_MAX_SECONDS;

const sumViews = (videos: readonly EarningsVideo[]): number =>
  videos.reduce((total, video) => total + video.views, 0);

/** The ad revenue range for the given videos' views. */
export function estimateEarnings(
  videos: readonly EarningsVideo[],
  subscribers: number | null,
  rates: EarningsRates = DEFAULT_RATES,
): EarningsEstimate {
  const shortsViews = sumViews(videos.filter(isShort));
  const longFormViews = sumViews(videos.filter((video) => !isShort(video)));
  const worth = (pick: (range: RateRange) => number): number =>
    Math.round(
      (longFormViews / VIEWS_PER_RATE_UNIT) * pick(rates.longForm) +
        (shortsViews / VIEWS_PER_RATE_UNIT) * pick(rates.shorts),
    );
  return {
    low: worth((range) => range.low),
    high: worth((range) => range.high),
    longFormViews,
    shortsViews,
    belowAdThreshold: subscribers === null ? null : subscribers < MIN_SUBSCRIBERS_FOR_ADS,
  };
}
