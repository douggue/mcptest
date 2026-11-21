import type { ThumbnailBoard } from '@jgtube/core';
import { describe, expect, test } from 'vitest';
import { chooseThumbnails, thumbnailFiles } from '../src/thumbnailFiles';

const id = (prefix: string, n: number): string =>
  `${prefix}${String(n).padStart(11 - prefix.length, '0')}`;
const video = (videoId: string, score = 5) => ({
  videoId,
  title: `Title ${videoId}`,
  views: 1000,
  score,
  publishedRaw: '1w ago',
  ageDays: 7,
  durationSeconds: 600,
});

function board(channels: number): ThumbnailBoard {
  return {
    mapId: 1,
    center: {
      id: 'UCcenter',
      title: 'Mine',
      subscribers: 10,
      videos: [1, 2, 3, 4, 5].map((n) => video(id('o', n), 1)),
    },
    channels: Array.from({ length: channels }, (_, c) => ({
      id: `UC${c}`,
      title: `Peer ${c}`,
      subscribers: 100,
      winners: [1, 2, 3].map((n) => video(id(`w${c}`, n), 6)),
      ordinary: [1, 2, 3].map((n) => video(id(`n${c}`, n), 1)),
      winnerCount: 3,
      scoredCount: 9,
    })),
    winnerMinScore: 3,
    ordinaryMaxScore: 1.2,
  };
}

describe('chooseThumbnails', () => {
  test('takes the owner’s last four, then winners and ordinary ones of the closest channels', () => {
    // Act
    const groups = chooseThumbnails(board(10));

    // Assert
    expect(groups[0]).toEqual({
      label: 'your own',
      videoIds: [1, 2, 3, 4].map((n) => id('o', n)),
    });
    expect(groups[1]).toEqual({
      label: 'channel 1 on the board, winners',
      videoIds: [id('w0', 1), id('w0', 2)],
    });
    expect(groups[2]).toEqual({
      label: 'channel 1 on the board, ordinary',
      videoIds: [id('n0', 1), id('n0', 2)],
    });
    // Channels 5 to 8 give winners only; channels past 8 are left out.
    expect(groups.map((group) => group.label)).toContain('channel 8 on the board, winners');
    expect(groups.map((group) => group.label)).not.toContain('channel 5 on the board, ordinary');
    expect(groups.map((group) => group.label)).not.toContain('channel 9 on the board, winners');
  });

  test('leaves out empty groups', () => {
    const empty = { ...board(1), center: { ...board(1).center, videos: [] } };
    expect(chooseThumbnails(empty).map((group) => group.label)).not.toContain('your own');
  });
});

describe('thumbnailFiles', () => {
  test('fetches each chosen thumbnail as a file named after its video and lists them', async () => {
    // Arrange
    const fetched: string[] = [];
    const fetch = async (videoId: string) => {
      fetched.push(videoId);
      return videoId === id('w0', 2)
        ? ({ ok: false, reason: 'gone' } as const)
        : ({ ok: true, bytes: new Uint8Array([9]), mimeType: 'image/jpeg' } as const);
    };

    // Act
    const set = await thumbnailFiles(board(1), fetch);

    // Assert
    expect(fetched).toHaveLength(8);
    expect(set.files.map((file) => file.name)).toContain(`thumb-${id('o', 1)}.jpg`);
    expect(set.files.map((file) => file.name)).not.toContain(`thumb-${id('w0', 2)}.jpg`);
    expect(set.listing).toContain(`your own: @thumb-${id('o', 1)}.jpg`);
    expect(set.listing).toContain(`channel 1 on the board, winners: @thumb-${id('w0', 1)}.jpg;`);
    expect(set.listing).not.toContain(id('w0', 2));
    // Titles and channel names are not code's to put into a question.
    expect(set.listing).not.toContain('Peer');
    expect(set.listing).not.toContain('Title');
  });

  test('refuses when no thumbnail could be fetched', async () => {
    const fetch = async () => ({ ok: false, reason: 'offline' }) as const;
    await expect(thumbnailFiles(board(1), fetch)).rejects.toThrow(/No thumbnails/);
  });
});
