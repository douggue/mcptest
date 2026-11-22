/**
 * The reads of a production teardown: how many AI runs one would take, its
 * pictures (by fixed name only), its Markdown and the whole folder as a ZIP.
 * Every path part is checked against a fixed pattern before it is used; the
 * pictures come from the local store, so the page's `img-src 'self'` holds.
 */
import type { AppOptions } from './app';
import { fail, ok } from './http';

export const TEARDOWN_PATH =
  /^\/api\/video-teardowns\/([\w-]{11})\/(teardown\.md|export\.zip|images\/([\w.-]{1,40}))$/;
export const TEARDOWN_RUNS_PATH = '/api/video-teardowns/runs';

const VIDEO_ID = /^[\w-]{11}$/;

function download(body: Uint8Array | string, type: string, name: string): Response {
  return new Response(typeof body === 'string' ? body : Buffer.from(body), {
    status: 200,
    headers: {
      'content-type': type,
      'content-disposition': `attachment; filename="${name}"`,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

async function runs(options: AppOptions, url: URL): Promise<Response> {
  const video = url.searchParams.get('video');
  if (video !== null && !VIDEO_ID.test(video))
    return fail(400, 'Give a video id of 11 characters.');
  const fresh = url.searchParams.get('fresh') === '1';
  return ok(await options.engine.hub.teardownRuns(video, fresh));
}

async function teardownFile(
  options: AppOptions,
  videoId: string,
  what: string,
  image: string | undefined,
) {
  const { hub } = options.engine;
  if (image !== undefined) {
    const bytes = await hub.teardownImage(videoId, image);
    if (bytes === null) return fail(404, 'There is no such picture.');
    return new Response(Buffer.from(bytes), {
      status: 200,
      headers: {
        'content-type': 'image/jpeg',
        'cache-control': 'private, max-age=300',
        'x-content-type-options': 'nosniff',
      },
    });
  }
  if (what === 'teardown.md') {
    const text = hub.teardownMarkdown(videoId);
    return text === null
      ? fail(404, 'This video has no teardown.')
      : download(text, 'text/markdown; charset=utf-8', `teardown-${videoId}.md`);
  }
  const zip = await hub.teardownZip(videoId);
  return zip === null
    ? fail(404, 'This video has no teardown.')
    : download(zip, 'application/zip', `teardown-${videoId}.zip`);
}

/** The answer for a teardown path; null for any other path. */
export function teardownRoutes(
  options: AppOptions,
  request: Request,
  url: URL,
): Promise<Response> | Response | null {
  const isRuns = url.pathname === TEARDOWN_RUNS_PATH;
  const match = TEARDOWN_PATH.exec(url.pathname);
  if (!isRuns && match === null) return null;
  if (request.method !== 'GET') return fail(405, 'Use GET');
  if (isRuns) return runs(options, url);
  const [, videoId = '', what = '', image] = match ?? [];
  return teardownFile(options, videoId, what, image);
}
