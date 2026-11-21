/**
 * The files a breakdown works from, on this computer: the owner's own copy of
 * a video, a copy Jgtube downloads, the frames ffmpeg cuts from either, and a
 * smaller copy for an engine that will not open a large file.
 *
 * What Jgtube made (a download, cut frames, a smaller copy) is temporary and
 * removed after use. The owner's own files are only ever read.
 */
import {
  MAX_VIDEO_BYTES,
  cutFrameSheets,
  findFfmpeg,
  findOwnVideo,
  ownVideosFolder,
  removeFrameSheets,
  removeVideoFile,
  shrinkForWatching,
} from '@jgtube/core';
import { stat } from 'node:fs/promises';
import type { BreakdownFiles } from './breakdownEngine';
import type { DownloadVideo } from './engines/videoWatch';

export interface BreakdownFilesDeps {
  /** The downloads folder. Throws when the store is only in memory and no folder is named. */
  readonly root: () => string;
  /** Fetches a copy of a video, which comes with the way to remove it. */
  readonly fetch: DownloadVideo;
  /** Aborted when Jgtube is closing: ffmpeg is stopped. */
  readonly stop: AbortSignal;
  /** Where to look for ffmpeg; tests replace it. */
  readonly env?: Readonly<Record<string, string | undefined>>;
}

const megabytes = (bytes: number): number => Math.round(bytes / 1_000_000);

export function breakdownFiles(deps: BreakdownFilesDeps): BreakdownFiles {
  /** The downloads folder, or null for a store that is only in memory: then there are no files. */
  const root = (): string | null => {
    try {
      return deps.root();
    } catch {
      return null;
    }
  };
  const ffmpeg = { ...(deps.env ? { env: deps.env } : {}), signal: deps.stop };

  return {
    ownFolder() {
      const folder = root();
      return folder === null ? null : ownVideosFolder(folder);
    },

    async own(videoId) {
      const folder = root();
      return folder === null ? null : findOwnVideo(folder, videoId);
    },

    fetch: deps.fetch,

    canCut: async () => (await findFfmpeg(deps.env)) !== null,

    async cut(videoId, path) {
      const folder = root();
      if (folder === null) return { ok: false, reason: 'there is no downloads folder to cut into' };
      return cutFrameSheets(
        { videoId, path },
        { root: folder, alsoFrom: [ownVideosFolder(folder)], ...ffmpeg },
      );
    },

    async removeFrames(videoId) {
      const folder = root();
      if (folder !== null) await removeFrameSheets(folder, videoId);
    },

    async forWatching(videoId, path) {
      const folder = root();
      const { size } = await stat(path);
      if (size <= MAX_VIDEO_BYTES) return { ok: true, path };
      const tooBig = `the file is ${megabytes(size)} MB, more than the ${megabytes(MAX_VIDEO_BYTES)} MB an engine will open`;
      if (folder === null) return { ok: false, reason: tooBig };
      const small = await shrinkForWatching(
        { videoId, path },
        {
          root: folder,
          maxBytes: MAX_VIDEO_BYTES,
          alsoFrom: [ownVideosFolder(folder)],
          ...ffmpeg,
        },
      );
      return small.ok
        ? { ok: true, path: small.path, remove: () => removeVideoFile(folder, small.path) }
        : { ok: false, reason: `${tooBig}, and a smaller copy could not be made: ${small.reason}` };
    },
  };
}
