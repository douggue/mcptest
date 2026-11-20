/**
 * The limits every part of Jgtube shares, each defined once.
 *
 * The engine works by them, and the API, the connector and the web app offer
 * and check the same numbers. This file must not load anything: the web app
 * bundles it, and anything it loaded (the store, the YouTube client) would be
 * bundled for the browser too.
 */

/** Recommendation steps a map follows unless told otherwise. */
export const CRAWL_DEFAULT_DEPTH = 2;
/** The most steps a map may follow; each step multiplies the requests. */
export const CRAWL_MAX_DEPTH = 3;
/** Channels a map holds, centre included, unless told otherwise. */
export const CRAWL_DEFAULT_MAX_CHANNELS = 150;
/** The smallest and largest map that can be asked for through the app or the connector. */
export const CRAWL_MIN_CHANNELS_ASKED = 10;
export const CRAWL_MAX_CHANNELS_ASKED = 600;

/**
 * Channels read per refresh. Each costs a few page requests, taken one channel
 * at a time, so fifty is a few minutes of gentle traffic. Four runs a day
 * cover a store of 200 channels daily.
 */
export const REFRESH_DEFAULT_MAX_CHANNELS = 50;
/** The most channels one refresh may be asked to read. */
export const REFRESH_MAX_CHANNELS = 500;

/**
 * The line between a small channel and the rest: the niche list calls a
 * channel at or under it small, and the breakout feed's "Under 10K" filter
 * draws its line at the same number. Below it a channel has too few
 * subscribers to carry a video on its own, so one that takes off did so on its
 * topic and packaging, which is what the owner can copy.
 */
export const SMALL_CHANNEL_MAX_SUBSCRIBERS = 10_000;

/**
 * A channel whose newest upload is older than this has stopped, for now at
 * least, and is not competing for anyone's viewers, so a map does not count it
 * as a look-alike. Six weeks is past any ordinary gap: the slowest channels
 * worth copying publish monthly, and one missed month still leaves them inside
 * it. The owner can keep such a channel by hand.
 */
export const PEER_DORMANT_AFTER_DAYS = 45;
