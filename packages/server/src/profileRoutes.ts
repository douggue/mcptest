/** The route of a channel's own view: a read of one stored channel. */
import { fail, ok } from './http';
import { channelOf, type Context, type Routes } from './labHttp';

const NOT_STORED = 'This channel is not stored yet. It is read when a map reaches it.';

function readProfile(context: Context, url: URL): Response {
  const channel = channelOf(url);
  if (channel instanceof Response) return channel;
  const profile = context.options.engine.extras.findChannelProfile(channel);
  return profile ? ok(profile) : fail(404, NOT_STORED);
}

export const PROFILE_ROUTES: Routes = {
  '/api/channels/profile': { GET: (context, _request, url) => readProfile(context, url) },
};
