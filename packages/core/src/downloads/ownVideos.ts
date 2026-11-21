import { readdir, stat } from 'node:fs/promises';
import { VIDEO_ID_PATTERN } from '../sources/parse';
import { pathInside } from './folder';

/**
 * The owner's own copies of videos. When YouTube will not let a video be
 * downloaded, the owner can supply the file: through the page, which saves it
 * here under the video's id, or by copying it into this folder by hand.
 *
 * These files are the owner's. Jgtube reads them and never changes or
 * deletes them; only copies it downloaded itself are removed after use.
 */

/** The folder under the downloads folder that holds the owner's files. */
export const OWN_VIDEOS_FOLDER = 'my-videos';
/** The one kind of file taken: the kind the engine that watches is known to open. */
export const OWN_VIDEO_TYPE = '.mp4';
/**
 * The largest file taken from the page. The owner's own copy may be full
 * quality, and an hour of 1080p is around a gigabyte.
 */
export const MAX_OWN_VIDEO_BYTES = 2_000_000_000;

/** The folder for the owner's files, as an absolute path. */
export const ownVideosFolder = (root: string): string => pathInside(root, OWN_VIDEOS_FOLDER);

/** The name a file sent through the page is saved under. */
export function ownVideoName(videoId: string): string {
  if (!VIDEO_ID_PATTERN.test(videoId)) {
    throw new Error(`Not a valid YouTube video id: "${videoId.slice(0, 40)}"`);
  }
  return `${videoId}${OWN_VIDEO_TYPE}`;
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

/**
 * The owner's file for one video, as an absolute path, or null when there is
 * none. A file named exactly `<video id>.mp4` is taken first. Otherwise any
 * MP4 file whose name holds the id is taken (a downloader names files
 * "Title [id].mp4"), the first by name when there are several.
 */
export async function findOwnVideo(root: string, videoId: string): Promise<string | null> {
  const exact = ownVideoName(videoId);
  const folder = ownVideosFolder(root);
  const names = await readdir(folder).catch(() => [] as string[]);
  const matching = names
    .filter((name) => name.includes(videoId) && name.toLowerCase().endsWith(OWN_VIDEO_TYPE))
    .sort((a, b) => Number(b === exact) - Number(a === exact) || a.localeCompare(b));
  for (const name of matching) {
    const path = pathInside(folder, name);
    if (await isFile(path)) return path;
  }
  return null;
}
