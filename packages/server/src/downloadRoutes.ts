import { z } from 'zod';
import type { AppOptions } from './app';
import { fail, ok, readJson } from './http';
import { cleanMessage } from './jobs';

const CHANNEL_ID = /^UC[\w-]{22}$/;

const downloadRequest = z.object({ channel: z.string().regex(CHANNEL_ID) });

/**
 * Saves the transcripts of one stored channel's videos that took off as text
 * files on this computer and answers with the folder and how it went: how
 * many were saved, how many of the videos have no captions, and how many
 * could not be read. Checked like the thumbnail download.
 */
export async function downloadTranscripts(
  options: AppOptions,
  request: Request,
): Promise<Response> {
  const body = await readJson(options.allowedHosts, request);
  if (body instanceof Response) return body;
  const parsed = downloadRequest.safeParse(body);
  if (!parsed.success) return fail(400, 'Give the channel whose transcripts to save');
  try {
    const saved = await options.engine.saveTranscripts(parsed.data.channel);
    if (!saved) return fail(404, 'That channel has not been read yet');
    return ok({
      channel: saved.channelId,
      folder: saved.folder,
      indexFile: saved.indexFile,
      saved: saved.saved.length,
      noCaptions: saved.noCaptions.length,
      failed: saved.failed.length,
    });
  } catch (error) {
    return fail(500, `The transcripts could not be saved: ${cleanMessage(error)}`);
  }
}

/**
 * Saves one stored channel's winning and ordinary thumbnails as files on this
 * computer and answers with the folder and how it went. It goes through the
 * same Host, Origin, content-type and size checks as every other write. The
 * folder's path is the point of the answer, so it is given as it is; the
 * reason a save failed is cleaned like every other error.
 */
export async function downloadThumbnails(options: AppOptions, request: Request): Promise<Response> {
  const body = await readJson(options.allowedHosts, request);
  if (body instanceof Response) return body;
  const parsed = downloadRequest.safeParse(body);
  if (!parsed.success) return fail(400, 'Give the channel whose thumbnails to save');
  try {
    const saved = await options.engine.saveThumbnails(parsed.data.channel);
    if (!saved) return fail(404, 'That channel has not been read yet');
    return ok({
      channel: saved.channelId,
      folder: saved.folder,
      indexFile: saved.indexFile,
      total: saved.images.length,
      saved: saved.saved,
      alreadyThere: saved.alreadyThere,
      failed: saved.failed.length,
    });
  } catch (error) {
    return fail(500, `The thumbnails could not be saved: ${cleanMessage(error)}`);
  }
}
