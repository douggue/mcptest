import type { YouTubeSource } from '@jgtube/core';
import { describe, expect, test } from 'vitest';
import { NOT_READING, connectOnUse, stopWhen, type PlayerSource } from '../src/connection';

const base: YouTubeSource = {
  resolveChannelId: async () => 'x',
  fetchChannel: async () => {
    throw new Error('unused');
  },
  getSidebar: async () => [],
  fetchVideoPage: async () => {
    throw new Error('unused');
  },
};
const found = [{ videoId: 'aaaaaaaaaa1', channelId: `UC${'A'.repeat(22)}` }];

describe('searching through the shared connection', () => {
  test('goes through when the connection can search, and stops once Jgtube is closing', async () => {
    let closing = false;
    const source = stopWhen({ ...base, searchVideos: async () => found }, () => closing);
    expect(await source.searchVideos?.('rockets')).toEqual(found);
    closing = true;
    await expect(source.searchVideos?.('rockets')).rejects.toThrow(NOT_READING);
  });

  test('a connection that cannot search says so, and none is offered by stopWhen', async () => {
    expect(stopWhen(base, () => false).searchVideos).toBeUndefined();
    const lazy = connectOnUse(async (): Promise<PlayerSource> => base);
    await expect(lazy.searchVideos('x')).rejects.toThrow(/cannot search/);
    const able = connectOnUse(async (): Promise<PlayerSource> => ({
      ...base,
      searchVideos: async () => found,
    }));
    expect(await able.searchVideos('x')).toEqual(found);
  });
});
