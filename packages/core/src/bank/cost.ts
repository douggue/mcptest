/**
 * What "Find more outliers" costs, said before it starts, and the daily caps
 * it keeps. Pure: the web app imports this file for the numbers it shows.
 *
 * With the owner's API key everything goes through the official Data API
 * (search, then each channel's uploads and their views), counted in the units
 * of the key's daily allowance. Without one, the signed-out page reading the
 * rest of Jgtube uses does it, at its usual pace, counted in page requests.
 */
export type FindVia = 'api' | 'pages';

/** Channels one run reads unless told otherwise, and the most it may be asked to. */
export const BANK_FIND_DEFAULT_CHANNELS = 10;
export const BANK_FIND_MAX_CHANNELS = 25;
/**
 * Page requests "Find more outliers" may spend in any 24 hours without a key:
 * about four full runs, a small share of what one map of 150 channels takes.
 */
export const BANK_FIND_DAILY_PAGE_REQUESTS = 400;
/** API units it may spend in any 24 hours with a key: a sixth of the default 10,000. */
export const BANK_FIND_DAILY_API_UNITS = 1500;
export const BANK_FIND_WINDOW_HOURS = 24;

/** One search: a page of results either way; 100 units on the API. */
export const SEARCH_REQUESTS = 1;
export const API_SEARCH_UNITS = 100;
/**
 * The most page requests one channel takes signed out: its page, its videos
 * tab and up to three more pages of videos (the usual 100 newest).
 */
export const PAGE_REQUESTS_PER_CHANNEL = 5;
/**
 * The most API requests one channel takes: two pages of its uploads and two
 * of their views (the usual 100 newest), one unit each. The channels'
 * own details come fifty to a request on top.
 */
export const API_REQUESTS_PER_CHANNEL = 4;
const CHANNELS_PER_API_REQUEST = 50;

export interface FindPlan {
  readonly via: FindVia;
  readonly channels: number;
  /** The most requests the run can make: a channel already read today costs none. */
  readonly requests: number;
  /** The most API units it can spend; 0 without a key. */
  readonly apiUnits: number;
}

export function planFind(via: FindVia, channels: number): FindPlan {
  if (via === 'pages') {
    return {
      via,
      channels,
      requests: SEARCH_REQUESTS + channels * PAGE_REQUESTS_PER_CHANNEL,
      apiUnits: 0,
    };
  }
  const detailRequests = Math.ceil(channels / CHANNELS_PER_API_REQUEST);
  const requests = SEARCH_REQUESTS + detailRequests + channels * API_REQUESTS_PER_CHANNEL;
  return { via, channels, requests, apiUnits: API_SEARCH_UNITS + requests - SEARCH_REQUESTS };
}

export interface FindAllowance {
  readonly via: FindVia;
  /** What the cap allows in any 24 hours, in requests (pages) or units (API). */
  readonly cap: number;
  readonly used: number;
  readonly left: number;
}

/** What is left of the day's cap after what runs in the last 24 hours spent. */
export function findAllowance(via: FindVia, used: number): FindAllowance {
  const cap = via === 'api' ? BANK_FIND_DAILY_API_UNITS : BANK_FIND_DAILY_PAGE_REQUESTS;
  return { via, cap, used, left: Math.max(0, cap - used) };
}

/** What a plan spends against its cap. */
export const planSpend = (plan: FindPlan): number =>
  plan.via === 'api' ? plan.apiUnits : plan.requests;

/** The search words for a topic label: its words, without the ampersand. */
export const topicQuery = (label: string): string =>
  label.replace(/&/g, ' ').replace(/\s+/g, ' ').trim();
