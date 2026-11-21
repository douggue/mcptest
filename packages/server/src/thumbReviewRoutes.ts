/** The routes of the per-video thumbnail review: the videos to pick from, a kept review, asking for one. */
import { z } from 'zod';
import { ENGINE_IDS } from './engines/settings';
import { startExtrasAiJob, type ExtrasContext, type ExtrasRouteTable } from './extrasJobs';
import { fail, ok } from './http';
import { cleanMessage } from './jobs';
import { CHANNEL_ID, NO_MAP, bodyOf, channelOf } from './labHttp';

const VIDEO_ID = /^[\w-]{11}$/;
const askRequest = z.object({
  channel: z.string().regex(CHANNEL_ID),
  videoId: z.string().regex(VIDEO_ID),
  engine: z.enum(ENGINE_IDS).optional(),
});

function readVideos(context: ExtrasContext, url: URL): Response {
  const channel = channelOf(url);
  if (channel instanceof Response) return channel;
  const videos = context.options.engine.extras.thumbnailVideos(channel);
  return videos ? ok(videos) : fail(404, NO_MAP);
}

/** A video's kept review; `null` as the data when there is none yet. */
function readReview(context: ExtrasContext, url: URL): Response {
  const channel = channelOf(url);
  if (channel instanceof Response) return channel;
  const video = url.searchParams.get('video') ?? '';
  if (!VIDEO_ID.test(video)) return fail(400, 'Give the video as its id');
  return ok(context.options.engine.extras.findThumbnailReview(channel, video));
}

async function startAsk(context: ExtrasContext, request: Request): Promise<Response> {
  const body = await bodyOf(
    context,
    request,
    askRequest,
    'Give the channel id, the video id, and an engine if you choose one',
  );
  if (body instanceof Response) return body;
  const { extras } = context.options.engine;
  if (!extras.thumbnailVideos(body.channel)) return fail(404, NO_MAP);
  return startExtrasAiJob(
    context,
    async (report) => {
      try {
        const outcome = await extras.askThumbnailReview(
          body.channel,
          body.videoId,
          body.engine,
          (text) => report({ text }),
        );
        return { kind: 'thumbnail-review', outcome };
      } catch (error) {
        throw new Error(cleanMessage(error));
      }
    },
    {
      kind: 'thumbnail-review',
      title: 'Reviewing a thumbnail',
      channelId: body.channel,
      videoId: body.videoId,
    },
  );
}

export const THUMB_REVIEW_ROUTES: ExtrasRouteTable = {
  '/api/thumbnail-review': { GET: (context, _request, url) => readReview(context, url) },
  '/api/thumbnail-review/videos': { GET: (context, _request, url) => readVideos(context, url) },
  '/api/thumbnail-review/ask': { POST: startAsk },
};
