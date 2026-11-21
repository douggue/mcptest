/** The route of length and pacing against the winners: a read for one channel. */
import { fail, ok } from './http';
import { NO_MAP, channelOf, type Context, type Routes } from './labHttp';

function readPacing(context: Context, url: URL): Response {
  const channel = channelOf(url);
  if (channel instanceof Response) return channel;
  const pacing = context.options.engine.extras.findPacing(channel);
  return pacing ? ok(pacing) : fail(404, NO_MAP);
}

export const PACING_ROUTES: Routes = {
  '/api/pacing': { GET: (context, _request, url) => readPacing(context, url) },
};
