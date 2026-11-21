import { mkdir, stat, writeFile } from 'node:fs/promises';
import {
  ORDINARY_MAX_SCORE,
  WINNER_MIN_SCORE,
  boardChannel,
  type ScoredBoardVideo,
} from '../map/thumbnails';
import type { ChannelRepo, VideoRepo } from '../repos/types';
import { fetchFullThumbnail, type FetchImage } from '../sources/images';
import { CHANNEL_ID_PATTERN, VIDEO_ID_PATTERN } from '../sources/parse';
import { channelFolder, pathInside } from './folder';

/**
 * Saves the thumbnails of one channel's winning and ordinary videos (the ones
 * the thumbnail board shows for it) as image files, with an index saying what
 * each picture is. The files are for looking at outside the app, or for
 * handing to a tool that reads pictures from disk.
 */

/** The folder under the downloads folder that holds one folder per channel. */
export const THUMBNAILS_FOLDER = 'thumbnails';
export const THUMBNAIL_INDEX_FILE = 'index.json';
/** Pictures fetched at once: a handful, so a channel's dozen take a second or two and no more. */
const FETCH_BATCH = 4;
const JSON_INDENT = 2;

export interface ThumbnailDownloadDeps {
  readonly channels: ChannelRepo;
  readonly videos: VideoRepo;
  readonly now: () => Date;
  /** Replaces the network; used by tests. */
  readonly fetchImage?: FetchImage;
}

export interface ThumbnailDownloadOptions {
  /** Most winners, and most ordinary videos, to save. Defaults to what the board shows. */
  readonly perGroup?: number;
}

/** One saved picture, as the index file lists it. */
export interface SavedThumbnail {
  readonly videoId: string;
  readonly title: string;
  readonly views: number;
  /** Multiple of the channel's usual views. */
  readonly score: number;
  /** 'winner': far above the channel's usual views. 'ordinary': at or below them. */
  readonly group: 'winner' | 'ordinary';
  /** The file's name inside the channel's folder. */
  readonly file: string;
}

export interface ThumbnailDownload {
  readonly channelId: string;
  readonly channelTitle: string;
  /** The channel's folder, as an absolute path. */
  readonly folder: string;
  readonly indexFile: string;
  /** Pictures fetched and written by this call. */
  readonly saved: number;
  /** Pictures that were already in the folder, so nothing was fetched for them. */
  readonly alreadyThere: number;
  readonly failed: readonly { readonly videoId: string; readonly reason: string }[];
  /** Every picture now in the folder that the index lists. */
  readonly images: readonly SavedThumbnail[];
}

type Outcome =
  | { readonly kind: 'saved' | 'there'; readonly entry: SavedThumbnail }
  | { readonly kind: 'failed'; readonly videoId: string; readonly reason: string };

async function isSaved(path: string): Promise<boolean> {
  try {
    return (await stat(path)).size > 0;
  } catch {
    return false;
  }
}

async function saveOne(
  folder: string,
  entry: SavedThumbnail,
  fetchImage: FetchImage | undefined,
): Promise<Outcome> {
  const path = pathInside(folder, entry.file);
  if (await isSaved(path)) return { kind: 'there', entry };
  const image = await fetchFullThumbnail(entry.videoId, fetchImage);
  if (!image.ok) return { kind: 'failed', videoId: entry.videoId, reason: image.reason };
  await writeFile(path, image.bytes);
  return { kind: 'saved', entry };
}

/** The channel's winners, then its ordinary videos, each video once, as index entries. */
function entriesFor(
  winners: readonly ScoredBoardVideo[],
  ordinary: readonly ScoredBoardVideo[],
): readonly SavedThumbnail[] {
  const toEntry = (group: SavedThumbnail['group']) => (video: ScoredBoardVideo) => ({
    videoId: video.videoId,
    title: video.title,
    views: video.views,
    score: video.score,
    group,
    file: `${video.videoId}.jpg`,
  });
  const all = [...winners.map(toEntry('winner')), ...ordinary.map(toEntry('ordinary'))];
  // A video id becomes a file name, so one that is not an id is never written.
  return all.filter((entry) => VIDEO_ID_PATTERN.test(entry.videoId));
}

async function saveAll(
  folder: string,
  entries: readonly SavedThumbnail[],
  fetchImage: FetchImage | undefined,
): Promise<readonly Outcome[]> {
  let outcomes: readonly Outcome[] = [];
  for (let start = 0; start < entries.length; start += FETCH_BATCH) {
    const batch = entries.slice(start, start + FETCH_BATCH);
    const done = await Promise.all(batch.map((entry) => saveOne(folder, entry, fetchImage)));
    outcomes = [...outcomes, ...done];
  }
  return outcomes;
}

/**
 * Saves one stored channel's winning and ordinary thumbnails, at the largest
 * size YouTube has for each, under `<root>/thumbnails/<channel name>/`, one
 * JPEG per video named by its id, and
 * writes `index.json` beside them listing video id, title, views, score and
 * group for each. A picture already in the folder is not fetched again.
 * Returns null when the channel is not in the store.
 */
export async function saveChannelThumbnails(
  deps: ThumbnailDownloadDeps,
  channelId: string,
  root: string,
  options: ThumbnailDownloadOptions = {},
): Promise<ThumbnailDownload | null> {
  if (!CHANNEL_ID_PATTERN.test(channelId)) {
    throw new Error(`Not a valid YouTube channel id: "${channelId.slice(0, 40)}"`);
  }
  const channel = deps.channels.findById(channelId);
  if (!channel) return null;
  const board = boardChannel(
    { ...channel, videos: deps.videos.listByChannel(channelId) },
    deps.now(),
    options.perGroup === undefined
      ? {}
      : { winnersPerChannel: options.perGroup, ordinaryPerChannel: options.perGroup },
  );
  const folder = await channelFolder(
    pathInside(root, THUMBNAILS_FOLDER),
    channel,
    THUMBNAIL_INDEX_FILE,
  );
  await mkdir(folder, { recursive: true });
  const outcomes = await saveAll(
    folder,
    entriesFor(board.winners, board.ordinary),
    deps.fetchImage,
  );
  const images = outcomes.flatMap((outcome) => (outcome.kind === 'failed' ? [] : [outcome.entry]));
  const indexFile = pathInside(folder, THUMBNAIL_INDEX_FILE);
  const index = {
    channelId,
    channelTitle: channel.title,
    savedAt: deps.now().toISOString(),
    winnerMinScore: WINNER_MIN_SCORE,
    ordinaryMaxScore: ORDINARY_MAX_SCORE,
    images,
  };
  await writeFile(indexFile, `${JSON.stringify(index, null, JSON_INDENT)}\n`, 'utf8');
  return {
    channelId,
    channelTitle: channel.title,
    folder,
    indexFile,
    saved: outcomes.filter((outcome) => outcome.kind === 'saved').length,
    alreadyThere: outcomes.filter((outcome) => outcome.kind === 'there').length,
    failed: outcomes.flatMap((outcome) =>
      outcome.kind === 'failed' ? [{ videoId: outcome.videoId, reason: outcome.reason }] : [],
    ),
    images,
  };
}
