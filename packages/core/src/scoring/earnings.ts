/**
 * A rough range for what a set of views is worth in ad revenue.
 *
 * It is an estimate from public rules of thumb, not a measurement: the tool
 * cannot see whether a channel is monetised, where its viewers live or how
 * long they watch, and those move the real figure several times over. Where
 * the channel's own country is known the rate is scaled by a rough tier for it. The
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

/**
 * Which ad-rate tier a channel's country falls in. 'unknown': the store has no
 * country for the channel, so the top rate is assumed.
 */
export type RateTierId = 'top' | 'developed' | 'emerging' | 'unknown';

/**
 * How much of the long-video rate a tier is counted at. ROUGH RULES OF THUMB,
 * not measurements: advertisers pay most to reach viewers in a handful of
 * rich, mostly English-speaking markets, roughly half of that in the other
 * developed markets, and a small fraction of it across most of Africa, South
 * Asia, Latin America and the Caribbean. Published figures for the same
 * country differ severalfold, so only the order of the tiers and their rough
 * size mean anything.
 *
 * The tier is read from the country the channel's owner set, which is where
 * the channel is run from and only often, not always, where its viewers are: a
 * channel run from a lower tier that makes videos for a top-tier audience is
 * under-counted here, and the screen says which tier was used.
 */
export const RATE_TIER_MULTIPLIER: Readonly<Record<RateTierId, number>> = {
  top: 1,
  developed: 0.5,
  emerging: 0.2,
  unknown: 1,
};

/** The markets advertisers pay most to reach. */
const TOP_RATE_COUNTRIES: ReadonlySet<string> = new Set(
  'US CA GB AU DE NZ IE CH NO SE DK NL AT'.split(' '),
);
/** The rest of Europe and the other developed markets. Every other country is 'emerging'. */
const DEVELOPED_RATE_COUNTRIES: ReadonlySet<string> = new Set(
  (
    'FR IT ES PT BE LU FI IS GR CY MT PL CZ SK HU SI HR EE LV LT RO BG ' +
    'JP KR SG HK TW IL AE QA KW SA'
  ).split(' '),
);
const COUNTRY_CODE = /^[A-Z]{2}$/;

export interface RateTier {
  readonly id: RateTierId;
  /** The share of the long-video rate the estimate was made at. */
  readonly multiplier: number;
  /** The two-letter country the tier was read from; null when it is not known. */
  readonly country: string | null;
}

/** The tier for a channel's two-letter country; the top rate, marked unknown, without one. */
export function rateTierFor(country: string | null | undefined): RateTier {
  const code = (country ?? '').toUpperCase();
  if (!COUNTRY_CODE.test(code)) {
    return { id: 'unknown', multiplier: RATE_TIER_MULTIPLIER.unknown, country: null };
  }
  const id: RateTierId = TOP_RATE_COUNTRIES.has(code)
    ? 'top'
    : DEVELOPED_RATE_COUNTRIES.has(code)
      ? 'developed'
      : 'emerging';
  return { id, multiplier: RATE_TIER_MULTIPLIER[id], country: code };
}

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
  /** The tier the long-video rate was scaled by, so a reader can say what was assumed. */
  readonly rateTier: RateTier;
}

export interface EarningsOptions {
  /** The channel's two-letter country, when the store has it. */
  readonly country?: string | null;
  readonly rates?: EarningsRates;
}

const isShort = (video: EarningsVideo): boolean =>
  video.durationSeconds !== null && video.durationSeconds <= SHORTS_MAX_SECONDS;

const sumViews = (videos: readonly EarningsVideo[]): number =>
  videos.reduce((total, video) => total + video.views, 0);

/**
 * The ad revenue range for the given videos' views. The long-video rate is
 * scaled by the tier of the channel's country; Shorts are paid from a shared
 * pool at a rate already too rough to scale.
 */
export function estimateEarnings(
  videos: readonly EarningsVideo[],
  subscribers: number | null,
  options: EarningsOptions = {},
): EarningsEstimate {
  const rates = options.rates ?? DEFAULT_RATES;
  const rateTier = rateTierFor(options.country);
  const shortsViews = sumViews(videos.filter(isShort));
  const longFormViews = sumViews(videos.filter((video) => !isShort(video)));
  const worth = (pick: (range: RateRange) => number): number =>
    Math.round(
      (longFormViews / VIEWS_PER_RATE_UNIT) * pick(rates.longForm) * rateTier.multiplier +
        (shortsViews / VIEWS_PER_RATE_UNIT) * pick(rates.shorts),
    );
  return {
    low: worth((range) => range.low),
    high: worth((range) => range.high),
    longFormViews,
    shortsViews,
    belowAdThreshold: subscribers === null ? null : subscribers < MIN_SUBSCRIBERS_FOR_ADS,
    rateTier,
  };
}
