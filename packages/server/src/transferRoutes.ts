import { placeNamed, type Place } from '@jgtube/core';
import { z } from 'zod';
import type { AppOptions } from './app';
import { fail, ok, readJson } from './http';

/** An idea's key is the words of a title; no title is this long. */
const MAX_KEY_LENGTH = 300;
/** The longest a place name can sensibly be; anything longer is not one. */
const MAX_PLACE_LENGTH = 60;
const UNKNOWN_PLACE =
  'Jgtube does not know that place. Give a country, such as Canada, or its two-letter code.';

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
  return ok(
    options.engine.listTransfers({
      ...(channel === null ? {} : { channel }),
      ...(place === null ? {} : { place }),
    }),
  );
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
