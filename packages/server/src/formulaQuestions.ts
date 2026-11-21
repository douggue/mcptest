/**
 * The fixed question that finds title formulas: wordings the breakout titles
 * on one channel's map share, with named slots for what changes.
 *
 * The question holds no example formula, no word list and nothing taken from
 * any channel: the engine is to find the wordings in the titles the tools
 * return. What it answers is only a proposal. Which videos count, whether a
 * formula has enough behind it and every number shown are decided in code
 * (`verifyFormulas` in core).
 */
import { FORMULA_MAX_KEPT, FORMULA_MIN_VIDEOS, FORMULA_WINDOWS } from '@jgtube/core';

/** What a formula run is told besides the channel: how far back to look. */
export interface WindowFocus {
  readonly kind: 'window';
  readonly windowDays: number;
}

export const FORMULA_TOOLS = ['get_map', 'get_breakouts', 'get_channel_videos'] as const;
/** A map, the breakouts and up to eight channels' videos, then a short answer. */
export const FORMULA_MAX_TURNS = 24;
export const FORMULA_TIMEOUT_MS = 8 * 60 * 1000;
/** The breakout list goes back this far; a longer window needs the channels' own lists. */
const BREAKOUT_DAYS = 30;
/** How many look-alike channels' lists are read for a longer window. */
const CHANNELS_READ = 8;

/** What the formula run is asked, for a channel in its fixed form. */
export function formulasQuestion(channel: string, focus: WindowFocus): string {
  const days = FORMULA_WINDOWS.find((window) => window === focus.windowDays);
  if (days === undefined) throw new Error('That is not a window formulas can be found for');
  const further =
    days > BREAKOUT_DAYS
      ? `The breakout list only goes back ${BREAKOUT_DAYS} days, so also call get_channel_videos (order strongest, limit 30) for up to ${CHANNELS_READ} look-alike channels, starting with those that have breakouts, and take from each the videos with ageDays of at most ${days} that did clearly better than that channel's usual.`
      : '';
  return [
    `For the channel ${channel}: find the title formulas that the videos doing unusually well on this channel's map share, among videos from the last ${days} days.`,
    'Call get_map, then get_breakouts for this channel with limit 60.',
    further,
    "Use only titles these calls return for this channel's map. The store may hold other channels in other niches; nothing from them belongs here.",
    'A title formula is a wording that several of these titles share, with what changes from one to the next replaced by a named slot in square brackets: a short name for the kind of thing that goes there. Group titles by how they are built and what they promise the viewer, not by subject: videos on different subjects can share one formula.',
    `Each formula must rest on at least ${FORMULA_MIN_VIDEOS} videos, from different channels where the map has them. A wording only one video has is an example, not a formula: leave it out. Keep the fixed words the titles really share: a formula that is nothing but slots says nothing, and a formula with no slot is just a title. Do not invent a formula no title here uses, and put each video under the one formula it fits best.`,
    `Give up to ${FORMULA_MAX_KEPT} formulas, the ones with the most videos first. Give fewer when the titles support fewer.`,
    'Answer in exactly this form and nothing else. For each formula, three lines, each starting with its label.',
    'FORMULA: the wording with its slots.',
    'WHY: one sentence on why this wording works on a viewer, resting on the titles themselves.',
    'VIDEOS: the video ids of the videos it was drawn from, separated by commas.',
    'Do not forecast or promise views, and give no numbers of your own: Jgtube works out the counts and scores itself.',
  ]
    .filter((part) => part !== '')
    .join(' ');
}
