/**
 * What a niche sweep may read, said before it starts. Pure: the web app
 * imports this file for the numbers it shows.
 *
 * One number is the owner's: the YouTube reading budget per day, in page
 * requests. "Find more outliers" and the sweeps share it. A higher budget
 * means more reading from the address YouTube sees (the proxy's when one is
 * set); it never changes how fast a page is asked for, which is the pace
 * limiter's business and the same for every budget.
 */
import {
  API_REQUESTS_PER_CHANNEL,
  API_SEARCH_UNITS,
  BANK_FIND_DAILY_API_UNITS,
  BANK_FIND_DAILY_PAGE_REQUESTS,
  PAGE_REQUESTS_PER_CHANNEL,
  SEARCH_REQUESTS,
  type FindVia,
} from '../bank/cost';

/** The budget until the owner chooses one: the cap "Find more outliers" always had. */
export const READING_BUDGET_DEFAULT = BANK_FIND_DAILY_PAGE_REQUESTS;
/** The least it can be set to: one keyword's search and its channels, with room to spare. */
export const READING_BUDGET_MIN = 100;
/** The most: five times the default, about what one large map reads. */
export const READING_BUDGET_MAX_MULTIPLE = 5;
export const READING_BUDGET_MAX = READING_BUDGET_DEFAULT * READING_BUDGET_MAX_MULTIPLE;
export const READING_BUDGET_STEP = 50;

/** Said beside the budget on the page, word for word. */
export const READING_BUDGET_HELP =
  'How many YouTube pages Jgtube may read in a day for sweeps and “Find more outliers”. A higher budget means more reading from the address YouTube sees: your proxy’s when one is set in Settings, otherwise your own. It never makes reading faster; pages are asked for at the same pace either way.';

/** Channels read for one keyword in one sweep, most found first. */
export const SWEEP_CHANNELS_PER_KEYWORD = 10;
/** A stored channel read this recently is not read again by a sweep; the refresh keeps it current. */
export const SWEEP_REREAD_DAYS = 7;
/** A watch page read for its sidebar is two requests: the video and what stands beside it. */
export const SIDEBAR_PAGE_REQUESTS = 2;
/** The snowball: how many new niche channels it starts from, and how far it goes from each. */
export const SNOWBALL_MAX_SOURCES = 5;
export const SNOWBALL_VIDEOS_PER_SOURCE = 2;
export const SNOWBALL_SIBLINGS_PER_SOURCE = 3;
/** The share of what is left that the keywords leave for the snowball. */
export const SNOWBALL_BUDGET_SHARE = 0.25;
/** The most API units one channel takes: its uploads and their views, and its own details. */
export const API_UNITS_PER_CHANNEL = API_REQUESTS_PER_CHANNEL + 1;

/** The schedule: off (null), daily (1) or every N days. */
export const SWEEP_MAX_EVERY_DAYS = 30;
/** A day's turn comes after 20 hours, as the refresh's does, so an early start still finds it due. */
export const SWEEP_DAY_HOURS = 20;
/** After YouTube refuses, nothing is swept for this long. */
export const SWEEP_REFUSAL_REST_HOURS = 24;
/** Keywords the owner may keep, and how long one may be. */
export const SWEEP_MAX_KEYWORDS = 50;
export const SWEEP_MAX_KEYWORD_LENGTH = 80;

/** Two pots: page requests (signed-out reading) and units of the owner's API key. */
export interface Pots {
  readonly pages: number;
  readonly units: number;
}

export const NO_SPEND: Pots = { pages: 0, units: 0 };

export const addPots = (a: Pots, b: Pots): Pots => ({
  pages: a.pages + b.pages,
  units: a.units + b.units,
});

export const covers = (left: Pots, cost: Pots): boolean =>
  left.pages >= cost.pages && left.units >= cost.units;

/** What one search, one channel and one sidebar cost at most, by the way YouTube is read. */
export function sweepCosts(via: FindVia): {
  readonly search: Pots;
  readonly channel: Pots;
  readonly sidebar: Pots;
} {
  const sidebar = { pages: SIDEBAR_PAGE_REQUESTS, units: 0 };
  return via === 'api'
    ? {
        search: { pages: 0, units: API_SEARCH_UNITS },
        channel: { pages: 0, units: API_UNITS_PER_CHANNEL },
        sidebar,
      }
    : {
        search: { pages: SEARCH_REQUESTS, units: 0 },
        channel: { pages: PAGE_REQUESTS_PER_CHANNEL, units: 0 },
        sidebar,
      };
}

const times = (cost: Pots, count: number): Pots => ({
  pages: cost.pages * count,
  units: cost.units * count,
});

/** The most one keyword can take: its search and every channel it may read. */
export function keywordCost(via: FindVia): Pots {
  const costs = sweepCosts(via);
  return addPots(costs.search, times(costs.channel, SWEEP_CHANNELS_PER_KEYWORD));
}

/** The most the snowball can take in one sweep. */
export function snowballCost(via: FindVia): Pots {
  const costs = sweepCosts(via);
  const sidebars = SNOWBALL_MAX_SOURCES * SNOWBALL_VIDEOS_PER_SOURCE;
  const siblings = SNOWBALL_MAX_SOURCES * SNOWBALL_SIBLINGS_PER_SOURCE;
  return addPots(times(costs.sidebar, sidebars), times(costs.channel, siblings));
}

/** What the keywords may spend of what is left, so the snowball keeps its share. */
export const keywordShare = (left: Pots): Pots => ({
  pages: Math.floor(left.pages * (1 - SNOWBALL_BUDGET_SHARE)),
  units: Math.floor(left.units * (1 - SNOWBALL_BUDGET_SHARE)),
});

export interface SweepPlan {
  readonly via: FindVia;
  /** Active keywords, and how many of them today's budget can cover in full. */
  readonly keywords: number;
  readonly keywordsCovered: number;
  /** The most the sweep can spend: never more than what is left. */
  readonly most: Pots;
}

const fits = (pot: number, each: number): number =>
  each === 0 ? Number.POSITIVE_INFINITY : Math.floor(pot / each);

/** The most a sweep of this many keywords can cost against what is left today. */
export function planSweep(via: FindVia, keywords: number, left: Pots): SweepPlan {
  const each = keywordCost(via);
  const share = keywordShare(left);
  const covered = Math.min(keywords, fits(share.pages, each.pages), fits(share.units, each.units));
  const wanted = addPots(times(each, keywords), snowballCost(via));
  return {
    via,
    keywords,
    keywordsCovered: covered,
    most: { pages: Math.min(left.pages, wanted.pages), units: Math.min(left.units, wanted.units) },
  };
}

export interface PotAllowance {
  readonly cap: number;
  readonly used: number;
  readonly left: number;
}

export interface SweepAllowance {
  readonly pages: PotAllowance;
  /** Null without an API key. */
  readonly units: PotAllowance | null;
}

const allowance = (cap: number, used: number): PotAllowance => ({
  cap,
  used,
  left: Math.max(0, cap - used),
});

/** What is left of today's budget after what the last 24 hours spent. */
export function sweepAllowance(via: FindVia, pageBudget: number, used: Pots): SweepAllowance {
  return {
    pages: allowance(pageBudget, used.pages),
    units: via === 'api' ? allowance(BANK_FIND_DAILY_API_UNITS, used.units) : null,
  };
}

export const leftOf = (allowed: SweepAllowance): Pots => ({
  pages: allowed.pages.left,
  units: allowed.units?.left ?? 0,
});

/** Why a budget cannot be saved, or null when it can. */
export function budgetProblem(value: number): string | null {
  return Number.isInteger(value) && value >= READING_BUDGET_MIN && value <= READING_BUDGET_MAX
    ? null
    : `Give a whole number of page requests from ${READING_BUDGET_MIN} to ${READING_BUDGET_MAX}`;
}

/** Why a schedule cannot be saved, or null when it can. Null days is off. */
export function scheduleProblem(everyDays: number | null): string | null {
  if (everyDays === null) return null;
  return Number.isInteger(everyDays) && everyDays >= 1 && everyDays <= SWEEP_MAX_EVERY_DAYS
    ? null
    : `Sweep every 1 to ${SWEEP_MAX_EVERY_DAYS} days, or turn the schedule off`;
}

/** A keyword as it is kept: trimmed, single spaces. */
export const tidyKeyword = (text: string): string => text.replace(/\s+/g, ' ').trim();

export function keywordProblem(text: string): string | null {
  const tidy = tidyKeyword(text);
  return tidy.length >= 2 && tidy.length <= SWEEP_MAX_KEYWORD_LENGTH
    ? null
    : `Give a keyword or topic of 2 to ${SWEEP_MAX_KEYWORD_LENGTH} characters`;
}
