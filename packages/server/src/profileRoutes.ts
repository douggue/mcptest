/** The route of a channel's own view: a read of one stored channel. */
import { fail, ok } from './http';
import { channelOf, type Context, type Routes } from './labHttp';

const NOT_A_CHANNEL =
  'Give a channel: an @handle, a youtube.com channel link or a channel id (UC…).';
const NOT_STORED = 'This channel is not stored yet. It is read when a map reaches it.';

function readProfile(context: Context, url: URL): Response {
  const channel = channelOf(url);
  if (channel instanceof Response) return channel;
  const profile = context.options.engine.extras.findChannelProfile(channel);
  return profile ? ok(profile) : fail(404, NOT_STORED);
}

/** Longer than any channel name or link worth searching for. */
const MAX_WORDS = 200;

/** The stored channels a few typed letters match, on any map or none. */
function searchChannels(context: Context, url: URL): Response {
  const words = (url.searchParams.get('q') ?? '').trim();
  if (words === '' || words.length > MAX_WORDS) {
    return fail(400, `Give 1 to ${MAX_WORDS} characters to search for`);
  }
  return ok({ channels: context.options.engine.extras.searchChannels(words) });
}

/** The stored channel a link, an @handle or a channel id names; null when the store has none. */
function findChannel(context: Context, url: URL): Response {
  const ref = (url.searchParams.get('channel') ?? '').trim();
  if (ref === '' || ref.length > MAX_WORDS) return fail(400, NOT_A_CHANNEL);
  try {
    return ok({ channel: context.options.engine.extras.findStoredChannel(ref) });
  } catch {
    return fail(400, NOT_A_CHANNEL);
  }
}

export const PROFILE_ROUTES: Routes = {
  '/api/channels/profile': { GET: (context, _request, url) => readProfile(context, url) },
  '/api/channels/search': { GET: (context, _request, url) => searchChannels(context, url) },
  '/api/channels/find': { GET: (context, _request, url) => findChannel(context, url) },
};
