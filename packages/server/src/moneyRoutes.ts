/**
 * The routes of the monetization signs: the stored verdicts of a list of
 * channels, and a check that reads one watch page per channel. A check reads
 * YouTube, so it takes the one slot a map, a refresh or a keyword search
 * takes, and is refused while any of them runs here or in another program.
 */
import { MAX_CHECK_CHANNELS, ReadingElsewhereError } from '@jgtube/core';
import { z } from 'zod';
import { fail, ok } from './http';
import { cleanMessage } from './jobs';
import { CHANNEL_ID, bodyOf, type Context, type Routes } from './labHttp';

/** More than any list the page shows at once. */
export const MAX_READ_CHANNELS = 200;
export const MONEY_BUSY =
  'A map, a refresh or a keyword search is reading YouTube. Check again when it has finished.';

const checkRequest = z.object({
  channels: z.array(z.string().regex(CHANNEL_ID)).min(1).max(MAX_CHECK_CHANNELS),
});

function readMoney(context: Context, url: URL): Response {
  const ids = (url.searchParams.get('channels') ?? '').split(',').filter((id) => id !== '');
  if (
    ids.length === 0 ||
    ids.length > MAX_READ_CHANNELS ||
    !ids.every((id) => CHANNEL_ID.test(id))
  ) {
    return fail(400, `Give 1 to ${MAX_READ_CHANNELS} channel ids, separated by commas`);
  }
  return ok({ verdicts: context.options.engine.extras.findMoney(ids) });
}

async function check(context: Context, request: Request): Promise<Response> {
  const body = await bodyOf(
    context,
    request,
    checkRequest,
    `Give 1 to ${MAX_CHECK_CHANNELS} channel ids to check`,
  );
  if (body instanceof Response) return body;
  const { jobs, engine } = context.options;
  if (jobs.isBusy() || engine.isReadingYouTube()) return fail(409, MONEY_BUSY);
  const run = jobs.hold(() => engine.extras.checkMoney(body.channels));
  if (!run) return fail(409, MONEY_BUSY);
  try {
    return ok(await run);
  } catch (error) {
    return error instanceof ReadingElsewhereError
      ? fail(409, MONEY_BUSY)
      : fail(502, `The check did not finish: ${cleanMessage(error)}`);
  }
}

export const MONEY_ROUTES: Routes = {
  '/api/money': { GET: (context, _request, url) => readMoney(context, url) },
  '/api/money/check': { POST: check },
};
