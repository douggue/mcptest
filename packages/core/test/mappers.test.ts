import { describe, expect, test } from 'vitest';
import { mapChannel, mapChannelVideo, mapSidebarItem } from '../src/sources/mappers';
import channelFixture from './fixtures/channel.json';
import channelVideos from './fixtures/channel-videos.json';
import sidebar from './fixtures/sidebar.json';

const NOW = new Date('2026-11-20T12:00:00Z');
const CHANNEL_ID = 'UCHnyfMqiRRG1u-2MsSQLbXA';

describe('mapChannel', () => {
  test('reads id, title, handle, subscribers and video count from a channel page', () => {
    const channel = mapChannel(channelFixture.header, channelFixture.metadata);

    expect(channel).toEqual({
      id: CHANNEL_ID,
      title: 'Veritasium',
      handle: 'veritasium',
      subscribers: 21_500_000,
      subscribersHidden: false,
      videoCount: 552,
    });
  });

  test('marks subscribers as hidden when the header does not state them', () => {
    const channel = mapChannel({ type: 'PageHeader' }, channelFixture.metadata);

    expect(channel?.subscribers).toBeNull();
    expect(channel?.subscribersHidden).toBe(true);
  });

  test('returns null when the page has no channel id', () => {
    expect(mapChannel(channelFixture.header, { title: 'No id' })).toBeNull();
  });
});

describe('mapChannelVideo', () => {
  test('reads a list item in the current format', () => {
    const video = mapChannelVideo(channelVideos[0], CHANNEL_ID, NOW);

    expect(video).toMatchObject({
      id: 'uXuQF_PPg5U',
      channelId: CHANNEL_ID,
      title: 'The Strangest Concept in Math',
      views: 1_500_000,
      durationSeconds: 2328,
    });
    expect(video?.published?.precision).toBe('day');
    expect(video?.published?.raw).toBe('1d ago');
  });

  test('reads a list item in the older format', () => {
    const legacy = {
      type: 'Video',
      id: 'abc123DEF45',
      title: { text: 'An older item' },
      short_view_count: { text: '12K views' },
      published: { text: '3 days ago' },
      duration: { text: '10:00' },
    };

    expect(mapChannelVideo(legacy, CHANNEL_ID, NOW)).toMatchObject({
      id: 'abc123DEF45',
      title: 'An older item',
      views: 12_000,
      durationSeconds: 600,
    });
  });

  test('returns null for items that are not videos', () => {
    const playlist = { ...channelVideos[0], content_type: 'PLAYLIST' };

    expect(mapChannelVideo(playlist, CHANNEL_ID, NOW)).toBeNull();
    expect(mapChannelVideo(null, CHANNEL_ID, NOW)).toBeNull();
    expect(mapChannelVideo('nonsense', CHANNEL_ID, NOW)).toBeNull();
  });
});

describe('mapSidebarItem', () => {
  test('reads the recommended video and the channel it belongs to', () => {
    expect(mapSidebarItem(sidebar[0], NOW)).toMatchObject({
      videoId: 'kRpahwRFWZA',
      title: 'They Built A Crazy Machine Under Antarctica',
      channelId: 'UC415bOPUcGSamy543abLmRA',
      channelName: 'Cleo Abram',
      channelHandle: 'CleoAbram',
      views: 228_000,
    });
  });

  test('keeps the channel id when the recommendation is from the same channel', () => {
    expect(mapSidebarItem(sidebar[2], NOW)?.channelId).toBe(CHANNEL_ID);
  });

  test('returns null for malformed items', () => {
    expect(mapSidebarItem({ type: 'LockupView' }, NOW)).toBeNull();
    expect(mapSidebarItem(undefined, NOW)).toBeNull();
  });
});
