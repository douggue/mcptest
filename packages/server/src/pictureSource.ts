/**
 * Makes the pictures a question needs into files, for an engine shown
 * pictures that way (Antigravity): the same pictures the picture tools would
 * have shown Claude Code or Codex.
 *
 * - `board`: thumbnails chosen from the channel's thumbnail board.
 * - `thumbnails`: named thumbnails, by role.
 * - `teardown`: the frame strips and keyframes measured in code for each video.
 * - `frames`: one video's frame sheets, each listed with its grid and times.
 *
 * Every file name is made in code from a checked video id and a fixed
 * pattern; no text from outside reaches a name or the listing.
 */
import {
  readTeardownImage,
  teardownImages,
  type FetchedImage,
  type ThumbnailBoard,
  type VideoFrames,
} from '@jgtube/core';
import type { RunFile } from './engines/types';
import { isVideoId } from './engines/videoId';
import { groupedFiles, type PictureFileSet, type PictureNeed } from './pictureFiles';
import { idFiles, thumbnailFiles } from './thumbnailFiles';

/** The strips and keyframes handed over per video, and in all, like the teardown's own picture stages. */
export const STRIPS_PER_VIDEO = 6;
export const KEYFRAMES_PER_VIDEO = 4;
export const MAX_TEARDOWN_PICTURES = 24;
/** The most frame sheets handed over: the longest video handed to the engines has about fifty. */
export const MAX_FRAME_SHEETS = 60;

const STRIP = /^s-\d{3}\.jpg$/;
const KEYFRAME = /^k-\d{3}\.jpg$/;

const SOURCE_WORDS: Readonly<Record<VideoFrames['source'], string>> = {
  preview: 'YouTube’s own preview frames, small and several seconds apart',
  file: 'frames cut from the video file, one a second',
};

export interface PictureSourceDeps {
  /** The channel's thumbnail board; null when it has no map. */
  readonly board: (channel: string) => ThumbnailBoard | null;
  readonly fetchThumbnail: (videoId: string) => Promise<FetchedImage>;
  /** The downloads folder, where the teardown pictures are kept; null when there is none. */
  readonly downloads: () => string | null;
  readonly readFrames: (
    videoId: string,
    sheets: number,
    from: number,
  ) => Promise<VideoFrames | null>;
}

/** The strips and keyframes of the measured videos, as files named `<video id>-<name>`. */
async function teardownFiles(
  root: string | null,
  videoIds: readonly string[],
): Promise<PictureFileSet> {
  if (root === null) return groupedFiles([]);
  const groups = await Promise.all(
    videoIds.filter(isVideoId).map(async (videoId, index) => {
      const names = await teardownImages(root, videoId);
      const chosen = [
        ...names.filter((name) => STRIP.test(name)).slice(0, STRIPS_PER_VIDEO),
        ...names.filter((name) => KEYFRAME.test(name)).slice(0, KEYFRAMES_PER_VIDEO),
      ];
      const files = await Promise.all(
        chosen.map(async (name): Promise<RunFile[]> => {
          const bytes = await readTeardownImage(root, videoId, name);
          return bytes === null ? [] : [{ name: `${videoId}-${name}`, bytes }];
        }),
      );
      return {
        label: `video ${index + 1} (${videoId}), strips and keyframes`,
        files: files.flat(),
      };
    }),
  );
  let room = MAX_TEARDOWN_PICTURES;
  const capped = groups.map((group) => {
    const files = group.files.slice(0, Math.max(room, 0));
    room -= files.length;
    return { ...group, files };
  });
  return groupedFiles(capped);
}

const sheetName = (index: number): string => `frames-${String(index + 1).padStart(2, '0')}.jpg`;

/** One video's frame sheets as files, each listed with where its frames came from, its grid and times. */
async function frameFiles(deps: PictureSourceDeps, videoId: string): Promise<PictureFileSet> {
  if (!isVideoId(videoId)) throw new Error('Not a video id');
  const frames = await deps.readFrames(videoId, MAX_FRAME_SHEETS, 0);
  if (frames === null || frames.sheets.length === 0) {
    throw new Error('this video has no frames to look at');
  }
  const shown = frames.sheets.flatMap((entry) =>
    entry.image.ok
      ? [{ file: { name: sheetName(entry.sheet.index), bytes: entry.image.bytes }, entry }]
      : [],
  );
  if (shown.length === 0) throw new Error('none of its frame sheets could be loaded');
  const head = `${SOURCE_WORDS[frames.source]}; the video has ${frames.frameCount} frames on ${frames.sheetCount} sheets`;
  const lines = shown.map(({ file, entry }) => `@${file.name} is ${entry.caption}`);
  return { files: shown.map(({ file }) => file), listing: `${head}. ${lines.join(' ')}` };
}

/** The pictures a question needs, as files. Rejects when none could be had where some are needed. */
export const pictureSource =
  (deps: PictureSourceDeps) =>
  (channel: string, need: PictureNeed): Promise<PictureFileSet> => {
    switch (need.kind) {
      case 'thumbnails':
        return idFiles(need.groups, deps.fetchThumbnail);
      case 'teardown':
        return teardownFiles(deps.downloads(), need.videoIds);
      case 'frames':
        return frameFiles(deps, need.videoId);
      case 'board': {
        const board = deps.board(channel);
        if (!board) return Promise.reject(new Error('this channel has no map yet'));
        return thumbnailFiles(board, deps.fetchThumbnail);
      }
    }
  };
