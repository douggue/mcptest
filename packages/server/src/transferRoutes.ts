import { placeForKey, placeNamed, type Place } from '@jgtube/core';
import { z } from 'zod';
import type { AppOptions } from './app';
import { fail, ok, readJson } from './http';
import { cleanMessage } from './jobs';

/** An idea's key is the words of a title; no title is this long. */
const MAX_KEY_LENGTH = 300;
/** The longest a place name can sensibly be; anything longer is not one. */
const MAX_PLACE_LENGTH = 60;
const UNKNOWN_PLACE =
  'Jgtube does not know that place. Give a country, such as Canada, or its two-letter code.';

export const NO_KEY_FOR_COUNTRIES =
  'A channel’s country comes from the official YouTube API, which needs a YouTube API key. Add one in Settings.';

const saveRequest = z.object({
  key: z.string().min(1).max(MAX_KEY_LENGTH),
  saved: z.boolean(),
});

/** The place a request names; null when it names none; a response when it names one unknown. */
function placeAsked(url: URL): Place | null | Response {
  const asked = url.searchParams.get('place');
  if (asked === null || asked.trim() === '') return null;
  const place = asked.length <= MAX_PLACE_LENGTH ? placeNamed(asked) : null;
  return place ?? fail(400, UNKNOWN_PLACE);
}

/**
 * The transfer list over the whole store. `channel` is the channel on screen,
 * whose place the ideas are judged for; `place` overrides it. Both are
 * optional, and both are checked before the store is read.
 */
export function readTransfers(
  options: AppOptions,
  url: URL,
  channelProblem: (channel: string) => string | null,
): Response {
  const channel = url.searchParams.get('channel');
  const problem = channel === null ? null : channelProblem(channel);
  if (problem) return fail(400, problem);
  const place = placeAsked(url);
  if (place instanceof Response) return place;
  return ok({
    ...options.engine.listTransfers({
      ...(channel === null ? {} : { channel }),
      ...(place === null ? {} : { place }),
    }),
    // Whether the countries the list lacks can be read: it needs the owner's YouTube API key.
    canReadCountries: options.engine.canReadCountries(),
  });
}

const CHANNEL_ID = /^UC[\w-]{22}$/;
const placeRequest = z.object({
  channel: z.string().regex(CHANNEL_ID),
  /** A place by name or two-letter code; null goes back to what Jgtube works out. */
  place: z.string().min(1).max(MAX_PLACE_LENGTH).nullable(),
});
const countriesRequest = z.object({ channel: z.string().regex(CHANNEL_ID) });

/** Stores the place the owner chose for a channel, or removes the choice. */
export async function setPlace(options: AppOptions, request: Request): Promise<Response> {
  const body = await readJson(options.allowedHosts, request);
  if (body instanceof Response) return body;
  const parsed = placeRequest.safeParse(body);
  if (!parsed.success) return fail(400, 'Give the channel and a place, or null for no choice');
  const { channel } = parsed.data;
  // A key from the page's list, or a name or two-letter code typed by hand.
  const asked = parsed.data.place;
  const place = asked === null ? null : (placeForKey(asked) ?? placeNamed(asked));
  if (parsed.data.place !== null && place === null) return fail(400, UNKNOWN_PLACE);
  return options.engine.setOwnerPlace(channel, place?.key ?? null)
    ? ok({ channel, place })
    : fail(404, 'That channel has not been read yet');
}

/**
 * Reads the countries a channel's transfer list lacks from the official API.
 * One small request with the owner's key; it reads no YouTube page, so it
 * does not wait for a map or a refresh.
 */
export async function readCountries(options: AppOptions, request: Request): Promise<Response> {
  const body = await readJson(options.allowedHosts, request);
  if (body instanceof Response) return body;
  const parsed = countriesRequest.safeParse(body);
  if (!parsed.success) return fail(400, 'Give the channel whose list needs its countries');
  if (!options.engine.canReadCountries()) return fail(400, NO_KEY_FOR_COUNTRIES);
  try {
    const outcome = await options.engine.readCountries(parsed.data.channel);
    return outcome ? ok(outcome) : fail(404, 'That channel has not been read yet');
  } catch (error) {
    return fail(502, `The countries could not be read: ${cleanMessage(error)}`);
  }
}

/** Saves an idea as a transfer opportunity, or stops saving it. */
export async function saveTransfer(options: AppOptions, request: Request): Promise<Response> {
  const body = await readJson(options.allowedHosts, request);
  if (body instanceof Response) return body;
  const parsed = saveRequest.safeParse(body);
  if (!parsed.success) return fail(400, 'Give the idea’s key and saved');
  const { key, saved } = parsed.data;
  return options.engine.setTransferSaved(key, saved)
    ? ok({ key, saved })
    : fail(404, 'That idea is not among the videos of the last three months');
}
