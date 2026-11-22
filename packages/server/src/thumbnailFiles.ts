/**
 * Thumbnails as files, for an engine that is shown pictures as files rather
 * than as a tool's results (Antigravity; see `pictureCheck.ts`).
 *
 * Code chooses them from the thumbnail board, the same way every time: the
 * owner's latest few, then winners and ordinary ones of the closest channels,
 * then winners of the next ones. Each file is named after its video id, and
 * the question lists them by role alone: titles and channel names are text
 * from YouTube and reach an engine only as tool results.
 */
import type { FetchedImage, ThumbnailBoard } from '@jgtube/core';
import { isVideoId } from './engines/videoId';
import {
  groupedFiles,
  openedRule,
  type PictureFileSet,
  type PictureNeed,
  type ThumbnailGroup,
} from './pictureFiles';
import type { QuestionFocus } from './questionFocus';

export type { PictureFileSet, ThumbnailGroup } from './pictureFiles';

const OWN = 4;
const PER_GROUP = 2;
/** Channels shown with winners and ordinary ones, then channels shown with winners only. */
const CLOSE_CHANNELS = 4;
const MORE_CHANNELS = 4;

/** A picture question as asked of an engine shown the pictures as files, with the tools it may use then. */
export interface FilesRoute {
  readonly tools: readonly string[];
  /**
   * The pictures to hand over, chosen in code from what the question is
   * about; without it, thumbnails chosen from the channel's board.
   */
  readonly pictures?: (focus?: QuestionFocus) => PictureNeed;
  /**
   * The answer is JSON, which a line naming the files opened would spoil; its
   * answer is not checked for the file names.
   */
  readonly json?: boolean;
  readonly question: (channel: string, files: PictureFileSet, focus?: QuestionFocus) => string;
}

/** How a picture question has the engine look at the thumbnails, and how it finds each one's id. */
export interface PictureLook {
  readonly look: string;
  readonly ids: string;
}

/** Thumbnails handed as files: the listing comes from code, by role and file name only. */
export const filesLook = (files: PictureFileSet): PictureLook => ({
  look: `The thumbnails to look at are picture files in your folder. Open each one with your own file-reading tool and look at it: ${files.listing}. The channels are numbered in the order get_thumbnail_board lists them. ${openedRule()}`,
  ids: 'The id of each thumbnail is the part of its file name between "thumb-" and ".jpg"; get_thumbnail_board names its channel and title.',
});

export type FetchThumbnailFile = (videoId: string) => Promise<FetchedImage>;

const ids = (videos: readonly { readonly videoId: string }[], count: number): readonly string[] =>
  videos
    .map((video) => video.videoId)
    .filter(isVideoId)
    .slice(0, count);

/** Which thumbnails to show, by role; empty roles are left out. */
export function chooseThumbnails(board: ThumbnailBoard): readonly ThumbnailGroup[] {
  const channels = board.channels.slice(0, CLOSE_CHANNELS + MORE_CHANNELS);
  const groups: readonly ThumbnailGroup[] = [
    { label: 'your own', videoIds: ids(board.center.videos, OWN) },
    ...channels.flatMap((channel, index) => {
      const name = `channel ${index + 1} on the board`;
      const winners = { label: `${name}, winners`, videoIds: ids(channel.winners, PER_GROUP) };
      if (index >= CLOSE_CHANNELS) return [winners];
      return [winners, { label: `${name}, ordinary`, videoIds: ids(channel.ordinary, PER_GROUP) }];
    }),
  ];
  return groups.filter((group) => group.videoIds.length > 0);
}

export const thumbnailFileName = (videoId: string): string => `thumb-${videoId}.jpg`;

/** Named thumbnails fetched as files, by role. Rejects when none could be fetched. */
export function idFiles(
  groups: readonly ThumbnailGroup[],
  fetch: FetchThumbnailFile,
): Promise<PictureFileSet> {
  return groupFiles(
    groups.map((group) => ({ ...group, videoIds: group.videoIds.filter(isVideoId) })),
    fetch,
  );
}

/** The chosen thumbnails fetched as files. Rejects when none could be fetched. */
export const thumbnailFiles = (
  board: ThumbnailBoard,
  fetch: FetchThumbnailFile,
): Promise<PictureFileSet> => groupFiles(chooseThumbnails(board), fetch);

async function groupFiles(
  groups: readonly ThumbnailGroup[],
  fetch: FetchThumbnailFile,
): Promise<PictureFileSet> {
  const fetched = await Promise.all(
    groups.map(async (group) => {
      const images = await Promise.all(group.videoIds.map((videoId) => fetch(videoId)));
      const files = group.videoIds.flatMap((videoId, index) => {
        const image = images[index];
        return image?.ok ? [{ name: thumbnailFileName(videoId), bytes: image.bytes }] : [];
      });
      return { label: group.label, files };
    }),
  );
  const set = groupedFiles(fetched);
  if (set.files.length === 0) throw new Error('No thumbnails could be fetched to show as files.');
  return set;
}
