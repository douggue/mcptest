import { VIDEO_ID_PATTERN } from '@jgtube/core';
import { z } from 'zod';
import { ToolFailure } from './failure';

const MAX_CHANNEL_REF_LENGTH = 200;
export const DEFAULT_DEPTH = 2;
const MAX_DEPTH = 3;
const MIN_CHANNELS_PER_MAP = 10;
const MAX_CHANNELS_PER_MAP = 600;
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

const CHANNEL_RULE = 'channel is a YouTube handle such as @name, a channel URL or a channel id.';
const MODEL_RULE = 'model is a YouTube handle such as @name, a channel URL or a channel id.';
const VIDEO_ID_RULE = 'Video ids are 11 characters: letters, digits, "-" and "_".';
const VIDEO_COUNT_RULE = `Give 1 to ${MAX_THUMBNAILS_PER_CALL} video ids at a time.`;

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
      'Also list the channels on the map that are not look-alikes, each with why. Default false.',
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
    .enum(['strongest', 'newest'], { error: 'order is "strongest" or "newest".' })
    .optional()
    .describe('strongest (highest score first, the default) or newest.'),
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
  depth: wholeNumber('depth', 1, MAX_DEPTH)
    .optional()
    .describe(
      `How many recommendation steps to follow. Default ${DEFAULT_DEPTH}; 3 is much slower.`,
    ),
  max_channels: wholeNumber('max_channels', MIN_CHANNELS_PER_MAP, MAX_CHANNELS_PER_MAP)
    .optional()
    .describe('Most channels on the map, centre included. Default 150.'),
};

export const getMapArgs = z.object(getMapShape);
export const getBreakoutsArgs = z.object(getBreakoutsShape);
export const getThumbnailBoardArgs = z.object(getThumbnailBoardShape);
export const viewThumbnailsArgs = z.object(viewThumbnailsShape);
export const getChannelVideosArgs = z.object(getChannelVideosShape);
export const makeMapArgs = z.object(makeMapShape);

export type GetMapArgs = z.input<typeof getMapArgs>;
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
