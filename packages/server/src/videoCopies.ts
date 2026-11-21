/**
 * Temporary copies of videos, fetched so that an engine can watch one or so
 * that its frames can be cut. A copy belongs to whoever asked for it only
 * until they are done: it comes with the way to remove it, and any copy still
 * on disk when Jgtube closes is removed then.
 */
import {
  removeVideoFile,
  videoTempFolder,
  pathInside,
  type VideoDownload as FetchedVideo,
} from '@jgtube/core';
import { rmSync } from 'node:fs';
import type { DownloadVideo, VideoDownload } from './engines/videoWatch';
import { cleanMessage } from './jobs';

/** Fetches one video as a file; core's `downloadVideo` with the engine's settings filled in. */
export type FetchVideoFile = (videoId: string, stop: AbortSignal) => Promise<FetchedVideo>;

export interface VideoCopiesDeps {
  /** The downloads folder. Throws when the store is only in memory and no folder is named. */
  readonly root: () => string;
  readonly fetch: FetchVideoFile;
}

export interface VideoCopies {
  /** Fetches a copy; the answer carries the way to remove it. Never rejects. */
  readonly fetch: DownloadVideo;
  /** Removes, at once, every copy fetched and not yet removed. For when Jgtube closes. */
  removeLeftovers(): void;
}

const CLOSING = 'Jgtube is closing';

/** A failure's sentence as a reason that reads on after a colon: no full stop at its end. */
const asReason = (message: string): string => message.trim().replace(/\.$/, '');

const messageOf = (error: unknown): string => asReason(cleanMessage(error));

export function videoCopies(deps: VideoCopiesDeps): VideoCopies {
  /** The copies on disk now, each with the downloads folder it is under. */
  let held: ReadonlyMap<string, string> = new Map();
  const forget = (path: string): void => {
    held = new Map([...held].filter(([other]) => other !== path));
  };
  const removal = (root: string, path: string) => async (): Promise<void> => {
    forget(path);
    await removeVideoFile(root, path);
  };

  const fetch: DownloadVideo = async (videoId, stop): Promise<VideoDownload> => {
    try {
      const root = deps.root();
      const copy = await deps.fetch(videoId, stop);
      if (!copy.ok) return { ok: false, reason: asReason(copy.message) };
      held = new Map([...held, [copy.path, root]]);
      const remove = removal(root, copy.path);
      if (!stop.aborted) return { ok: true, path: copy.path, remove };
      await remove();
      return { ok: false, reason: CLOSING };
    } catch (error) {
      return { ok: false, reason: messageOf(error) };
    }
  };

  return {
    fetch,
    removeLeftovers() {
      for (const [path, root] of held) {
        try {
          // Only a file inside the temporary folder is ever removed, whatever was remembered.
          rmSync(pathInside(videoTempFolder(root), path), { force: true });
        } catch {
          // Held open by a program still letting go: cleared with the day-old copies later.
        }
      }
      held = new Map();
    },
  };
}
