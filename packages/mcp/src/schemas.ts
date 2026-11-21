import {
  BREAKDOWN_PARTS,
  COMPETITOR_STATUSES,
  CRAWL_DEFAULT_DEPTH,
  CRAWL_DEFAULT_MAX_CHANNELS,
  CRAWL_MAX_CHANNELS_ASKED,
  CRAWL_MAX_DEPTH,
  CRAWL_MIN_CHANNELS_ASKED,
  PEER_DORMANT_AFTER_DAYS,
  VIDEO_ID_PATTERN,
} from '@jgtube/core';
import { z } from 'zod';
import { ToolFailure } from './failure';

const MAX_CHANNEL_REF_LENGTH = 200;
export const DEFAULT_DEPTH = CRAWL_DEFAULT_DEPTH;
export const MAX_THUMBNAILS_PER_CALL = 8;

export const DEFAULT_MAP_CHANNELS = 30;
const MAX_MAP_CHANNELS = 100;
export const DEFAULT_BREAKOUTS = 15;
const MAX_BREAKOUTS = 60;
export const DEFAULT_BOARD_CHANNELS = 8;
const MAX_BOARD_CHANNELS = 30;
export const DEFAULT_BOARD_VIDEOS = 4;
const MAX_BOARD_VIDEOS = 6;
export const DEFAULT_CHANNEL_VIDEOS = 20;
const MAX_CHANNEL_VIDEOS = 100;

export const DEFAULT_NEAR_MISSES = 25;
const MAX_NEAR_MISSES = 50;
export const DEFAULT_NICHES = 15;
const MAX_NICHES = 50;
/** An idea carries several versions each, so fewer fit an answer than channels do. */
export const DEFAULT_TRANSFERS = 10;
const MAX_TRANSFERS = 30;
const MAX_PLACE_LENGTH = 60;

/** About three thousand tokens: a few minutes of speech, and room for several in one answer. */
export const DEFAULT_TRANSCRIPT_CHARS = 12_000;
const MIN_TRANSCRIPT_CHARS = 1000;
/** A whole half-hour video's captions fit in this. */
const MAX_TRANSCRIPT_CHARS = 40_000;
/** A day: far past any video, and a bound on what is asked for. */
const MAX_START_SECONDS = 86_400;
/** Four sheets of twenty-five frames show a video's beginning, middle and end. */
export const DEFAULT_FRAME_SHEETS = 4;
const MAX_FRAME_SHEETS = 6;
/** Far past the sheets any video has: a bound on what is asked for. */
const MAX_START_SHEET = 2000;
export const MAX_DETAIL_VIDEOS = 10;
/** Enough of a description to show its template: the opening lines, links and hashtags. */
export const DEFAULT_DESCRIPTION_CHARS = 1500;
const MIN_DESCRIPTION_CHARS = 200;
/** YouTube's own limit on a description. */
const MAX_DESCRIPTION_CHARS = 5000;
const MAX_VIDEO_REF_LENGTH = 200;
/** More places to cut a script at than any script has parts. */
const MAX_PACE_CUTS = 40;

const CENTER_RULE = 'center is a YouTube handle such as @name, a channel URL or a channel id.';
const CHANNEL_RULE = 'channel is a YouTube handle such as @name, a channel URL or a channel id.';
const MODEL_RULE = 'model is a YouTube handle such as @name, a channel URL or a channel id.';
export const PLACE_RULE =
  'place is a country or region name such as Canada, or a two-letter country code.';
const SHOW_RULE = 'show is "opportunities", "formats", "saved" or "all".';
const VIDEO_ID_RULE = 'Video ids are 11 characters: letters, digits, "-" and "_".';
const VIDEO_COUNT_RULE = `Give 1 to ${MAX_THUMBNAILS_PER_CALL} video ids at a time.`;
export const VIDEO_RULE = 'video is a YouTube video id (11 characters) or a link to one video.';
const DETAIL_COUNT_RULE = `Give 1 to ${MAX_DETAIL_VIDEOS} video ids at a time.`;
const PART_RULE = `part is one of: ${BREAKDOWN_PARTS.join(', ')}.`;
const CUTS_RULE = `cuts is up to ${MAX_PACE_CUTS} whole numbers of seconds, each from 1 to ${MAX_START_SECONDS}.`;

const channelRef = (rule: string) =>
  z.string({ error: rule }).min(1, rule).max(MAX_CHANNEL_REF_LENGTH, rule);

/** A whole number in a range, with one sentence that states the rule whatever was wrong. */
function wholeNumber(name: string, min: number, max: number) {
  const rule = `${name} is a whole number from ${min} to ${max}.`;
  return z.number({ error: rule }).int(rule).min(min, rule).max(max, rule);
}

const flag = (name: string) => z.boolean({ error: `${name} is true or false.` });

const channel = channelRef(CHANNEL_RULE).describe(
  'The channel the map is centred on (usually the owner’s own): @handle, channel URL or channel id.',
);

export const getMapShape = {
  channel,
  include_others: flag('include_others')
    .optional()
    .describe(
      'Also list the channels on the map that are not look-alikes, each with why: larger, dormant (no upload in ' +
        `the last ${PEER_DORMANT_AFTER_DAYS} days), cadence (publishes many times a day), length or titles. Default false.`,
    ),
  limit: wholeNumber('limit', 1, MAX_MAP_CHANNELS)
    .optional()
    .describe(`Most channels per list. Default ${DEFAULT_MAP_CHANNELS}.`),
};

export const getBreakoutsShape = {
  channel,
  lookalikes_only: flag('lookalikes_only')
    .optional()
    .describe(
      'Only videos from look-alike channels. Default true; false adds every channel on the map.',
    ),
  limit: wholeNumber('limit', 1, MAX_BREAKOUTS)
    .optional()
    .describe(`Most videos returned. Default ${DEFAULT_BREAKOUTS}.`),
};

export const getThumbnailBoardShape = {
  channel,
  channels: wholeNumber('channels', 1, MAX_BOARD_CHANNELS)
    .optional()
    .describe(`Most look-alike channels returned. Default ${DEFAULT_BOARD_CHANNELS}.`),
  per_channel: wholeNumber('per_channel', 1, MAX_BOARD_VIDEOS)
    .optional()
    .describe(
      `Most winners, and most ordinary videos, per channel. Default ${DEFAULT_BOARD_VIDEOS}.`,
    ),
};

export const viewThumbnailsShape = {
  video_ids: z
    .array(z.string({ error: VIDEO_ID_RULE }).regex(VIDEO_ID_PATTERN, VIDEO_ID_RULE), {
      error: VIDEO_COUNT_RULE,
    })
    .min(1, VIDEO_COUNT_RULE)
    .max(MAX_THUMBNAILS_PER_CALL, VIDEO_COUNT_RULE)
    .describe(`1 to ${MAX_THUMBNAILS_PER_CALL} video ids, as returned by the other tools.`),
};

export const getChannelVideosShape = {
  channel: channelRef(CHANNEL_RULE).describe(
    'Any channel on a stored map, or the owner’s own: @handle, channel URL or channel id.',
  ),
  order: z
    .enum(['strongest', 'newest', 'views'], {
      error: 'order is "strongest", "newest" or "views".',
    })
    .optional()
    .describe(
      'strongest (highest score first, the default), newest, or views (most viewed first).',
    ),
  limit: wholeNumber('limit', 1, MAX_CHANNEL_VIDEOS)
    .optional()
    .describe(`Most videos returned. Default ${DEFAULT_CHANNEL_VIDEOS}.`),
};

export const makeMapShape = {
  channel,
  model: channelRef(MODEL_RULE)
    .optional()
    .describe(
      'A channel the owner wants to be like. The crawl also explores from it and look-alikes are measured against it.',
    ),
  depth: wholeNumber('depth', 1, CRAWL_MAX_DEPTH)
    .optional()
    .describe(
      `How many recommendation steps to follow. Default ${DEFAULT_DEPTH}; ${CRAWL_MAX_DEPTH} is much slower.`,
    ),
  max_channels: wholeNumber('max_channels', CRAWL_MIN_CHANNELS_ASKED, CRAWL_MAX_CHANNELS_ASKED)
    .optional()
    .describe(`Most channels on the map, centre included. Default ${CRAWL_DEFAULT_MAX_CHANNELS}.`),
};

export const getNearMissesShape = {
  channel,
  limit: wholeNumber('limit', 1, MAX_NEAR_MISSES)
    .optional()
    .describe(`Most channels returned. Default ${DEFAULT_NEAR_MISSES}.`),
};

export const setCompetitorStatusShape = {
  center: channelRef(CENTER_RULE).describe(
    'The channel the map is centred on: @handle, channel URL or channel id.',
  ),
  channel: channelRef(CHANNEL_RULE).describe(
    'The channel on that map the decision is about: its id (from get_map or get_near_misses), @handle or URL.',
  ),
  status: z
    .enum(COMPETITOR_STATUSES, { error: 'status is "kept", "removed" or "auto".' })
    .describe(
      'kept: count it as a look-alike although the filter left it out. removed: never count it. auto: withdraw the decision and let the filter decide.',
    ),
};

export const listNichesShape = {
  limit: wholeNumber('limit', 1, MAX_NICHES)
    .optional()
    .describe(`Most channels returned. Default ${DEFAULT_NICHES}.`),
  watched_only: flag('watched_only')
    .optional()
    .describe('Only the channels the owner marked to watch. Default false.'),
};

export const listTransferOpportunitiesShape = {
  channel: channelRef(CHANNEL_RULE)
    .optional()
    .describe(
      'The channel the ideas are for: @handle, channel URL or channel id. Only videos of the channels on its map ' +
        'are compared, and the place its titles are about (or its country) is taken as the owner’s place. Always ' +
        'give it when asking for one channel: left out, every channel in the store is compared, which mixes niches.',
    ),
  place: z
    .string({ error: PLACE_RULE })
    .min(1, PLACE_RULE)
    .max(MAX_PLACE_LENGTH, PLACE_RULE)
    .optional()
    .describe(
      'The place the owner makes videos for, when they say it themselves: a country or region name, or a ' +
        'two-letter country code. Overrides what is worked out.',
    ),
  show: z
    .enum(['opportunities', 'formats', 'saved', 'all'], { error: SHOW_RULE })
    .optional()
    .describe(
      'opportunities (the default): ideas open or weak for the owner’s place. formats: title formats used for ' +
        'several subjects. saved: the ideas the owner saved. all: every idea made by two or more channels.',
    ),
  limit: wholeNumber('limit', 1, MAX_TRANSFERS)
    .optional()
    .describe('Most ideas or formats returned. Default ' + String(DEFAULT_TRANSFERS) + '.'),
};

const video = z
  .string({ error: VIDEO_RULE })
  .min(1, VIDEO_RULE)
  .max(MAX_VIDEO_REF_LENGTH, VIDEO_RULE)
  .describe(
    'One video: its id, as returned by the other tools, or a youtube.com or youtu.be link.',
  );

export const getTranscriptShape = {
  video,
  start_seconds: wholeNumber('start_seconds', 0, MAX_START_SECONDS)
    .optional()
    .describe('Leave out what is said before this many seconds in. Default 0: from the start.'),
  max_chars: wholeNumber('max_chars', MIN_TRANSCRIPT_CHARS, MAX_TRANSCRIPT_CHARS)
    .optional()
    .describe(`Most characters of transcript returned. Default ${DEFAULT_TRANSCRIPT_CHARS}.`),
};

export const viewVideoFramesShape = {
  video,
  sheets: wholeNumber('sheets', 1, MAX_FRAME_SHEETS)
    .optional()
    .describe(`How many sheets of frames to look at in one call. Default ${DEFAULT_FRAME_SHEETS}.`),
  start_sheet: wholeNumber('start_sheet', 1, MAX_START_SHEET)
    .optional()
    .describe(
      'Look at sheets in a row starting with this one (the first sheet is 1), to go through every frame of ' +
        'the video: start at 1 and follow next.start_sheet until an answer says last. Left out, the sheets ' +
        'are a sample spread evenly across the video.',
    ),
};

export const getVideoStudyShape = { video };

export const getTranscriptPaceShape = {
  video,
  cuts: z
    .array(
      z
        .number({ error: CUTS_RULE })
        .int(CUTS_RULE)
        .min(1, CUTS_RULE)
        .max(MAX_START_SECONDS, CUTS_RULE),
      { error: CUTS_RULE },
    )
    .max(MAX_PACE_CUTS, CUTS_RULE)
    .optional()
    .describe(
      'Where to cut the video, in seconds from its start, to have the pace of each part of a script counted: ' +
        'give the second each part after the first begins at. Left out, the video is cut every minute.',
    ),
};

export const getBreakdownPartShape = {
  channel: channelRef(CHANNEL_RULE).describe(
    'The channel the breakdown is of: @handle, channel URL or channel id.',
  ),
  part: z.enum(BREAKDOWN_PARTS, { error: PART_RULE }).describe(PART_RULE),
};

export const getChannelBrandShape = {
  channel: channelRef(CHANNEL_RULE).describe(
    'Any channel: @handle, channel URL or channel id. One not in the store yet is read from YouTube.',
  ),
  images: flag('images')
    .optional()
    .describe('Also return the logo and the cover as pictures. Default true.'),
};

export const getVideoDetailsShape = {
  video_ids: z
    .array(z.string({ error: VIDEO_ID_RULE }).regex(VIDEO_ID_PATTERN, VIDEO_ID_RULE), {
      error: DETAIL_COUNT_RULE,
    })
    .min(1, DETAIL_COUNT_RULE)
    .max(MAX_DETAIL_VIDEOS, DETAIL_COUNT_RULE)
    .describe(`1 to ${MAX_DETAIL_VIDEOS} video ids, as returned by the other tools.`),
  description_chars: wholeNumber('description_chars', MIN_DESCRIPTION_CHARS, MAX_DESCRIPTION_CHARS)
    .optional()
    .describe(
      `Most characters of each description returned. Default ${DEFAULT_DESCRIPTION_CHARS}.`,
    ),
};

/** Far past the number of concepts or batches any store holds: a bound on what is asked for. */
const MAX_ITEM_NUMBER = 1_000_000_000;
/** As many as a hook library holds. */
const MAX_HOOK_VIDEOS = 12;
const HOOK_COUNT_RULE = `Give 1 to ${MAX_HOOK_VIDEOS} video ids at a time.`;

const labChannel = channelRef(CHANNEL_RULE).describe(
  'The channel the idea lab is working for (the centre of a map): @handle, channel URL or channel id.',
);

export const getIdeaBriefShape = {
  channel: labChannel,
  batch: wholeNumber('batch', 1, MAX_ITEM_NUMBER).describe(
    'The number of the batch, as the question gives it.',
  ),
};

export const getConceptShape = {
  channel: labChannel,
  concept: wholeNumber('concept', 1, MAX_ITEM_NUMBER).describe(
    'The number of the concept, as the question gives it.',
  ),
};

export const getHooksShape = {
  channel: labChannel,
  video_ids: z
    .array(z.string({ error: VIDEO_ID_RULE }).regex(VIDEO_ID_PATTERN, VIDEO_ID_RULE), {
      error: HOOK_COUNT_RULE,
    })
    .min(1, HOOK_COUNT_RULE)
    .max(MAX_HOOK_VIDEOS, HOOK_COUNT_RULE)
    .optional()
    .describe('Only the hooks of these videos. Left out, every hook of the library.'),
};

const SCRIPT_PART_RULE = 'part is "plan", "draft" or "tightened".';

export const getScriptShape = {
  channel: labChannel,
  concept: wholeNumber('concept', 1, MAX_ITEM_NUMBER).describe(
    'The number of the concept the script is for, as the question gives it.',
  ),
  part: z
    .enum(['plan', 'draft', 'tightened'], { error: SCRIPT_PART_RULE })
    .optional()
    .describe(
      'plan (the default): the concept, the chosen hook and the beat sheet. draft: the draft as well. ' +
        'tightened: the tightened draft as well.',
    ),
};

export const getMapArgs = z.object(getMapShape);
export const getScriptArgs = z.object(getScriptShape);
export const getIdeaBriefArgs = z.object(getIdeaBriefShape);
export const getConceptArgs = z.object(getConceptShape);
export const getHooksArgs = z.object(getHooksShape);
export const getTranscriptArgs = z.object(getTranscriptShape);
export const viewVideoFramesArgs = z.object(viewVideoFramesShape);
export const getVideoStudyArgs = z.object(getVideoStudyShape);
export const getTranscriptPaceArgs = z.object(getTranscriptPaceShape);
export const getBreakdownPartArgs = z.object(getBreakdownPartShape);
export const getChannelBrandArgs = z.object(getChannelBrandShape);
export const getVideoDetailsArgs = z.object(getVideoDetailsShape);
export const getNearMissesArgs = z.object(getNearMissesShape);
export const setCompetitorStatusArgs = z.object(setCompetitorStatusShape);
export const listNichesArgs = z.object(listNichesShape);
export const listTransferOpportunitiesArgs = z.object(listTransferOpportunitiesShape);
export const getBreakoutsArgs = z.object(getBreakoutsShape);
export const getThumbnailBoardArgs = z.object(getThumbnailBoardShape);
export const viewThumbnailsArgs = z.object(viewThumbnailsShape);
export const getChannelVideosArgs = z.object(getChannelVideosShape);
export const makeMapArgs = z.object(makeMapShape);

export type GetMapArgs = z.input<typeof getMapArgs>;
export type GetScriptArgs = z.input<typeof getScriptArgs>;
export type GetIdeaBriefArgs = z.input<typeof getIdeaBriefArgs>;
export type GetConceptArgs = z.input<typeof getConceptArgs>;
export type GetHooksArgs = z.input<typeof getHooksArgs>;
export type GetTranscriptArgs = z.input<typeof getTranscriptArgs>;
export type ViewVideoFramesArgs = z.input<typeof viewVideoFramesArgs>;
export type GetVideoStudyArgs = z.input<typeof getVideoStudyArgs>;
export type GetTranscriptPaceArgs = z.input<typeof getTranscriptPaceArgs>;
export type GetBreakdownPartArgs = z.input<typeof getBreakdownPartArgs>;
export type GetChannelBrandArgs = z.input<typeof getChannelBrandArgs>;
export type GetVideoDetailsArgs = z.input<typeof getVideoDetailsArgs>;
export type GetNearMissesArgs = z.input<typeof getNearMissesArgs>;
export type SetCompetitorStatusArgs = z.input<typeof setCompetitorStatusArgs>;
export type ListNichesArgs = z.input<typeof listNichesArgs>;
export type ListTransferOpportunitiesArgs = z.input<typeof listTransferOpportunitiesArgs>;
export type GetBreakoutsArgs = z.input<typeof getBreakoutsArgs>;
export type GetThumbnailBoardArgs = z.input<typeof getThumbnailBoardArgs>;
export type ViewThumbnailsArgs = z.input<typeof viewThumbnailsArgs>;
export type GetChannelVideosArgs = z.input<typeof getChannelVideosArgs>;
export type MakeMapArgs = z.input<typeof makeMapArgs>;

/**
 * Checks a tool's input and returns it, or fails with the first rule it broke.
 * The protocol layer checks the same rules first; this keeps a handler safe
 * when it is called any other way.
 */
export function checkedArgs<T>(schema: z.ZodType<T>, args: unknown): T {
  const parsed = schema.safeParse(args);
  if (parsed.success) return parsed.data;
  throw new ToolFailure(parsed.error.issues[0]?.message ?? 'The input is not valid.');
}
