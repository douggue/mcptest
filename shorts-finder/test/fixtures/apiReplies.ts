/**
 * Hand-written replies shaped like the ones the YouTube Data API v3 documents
 * for search.list, videos.list, channels.list and playlistItems.list. They were
 * not recorded from the live API: every id, title and number is made up, and
 * the subjects are deliberately unrelated to each other (paper craft, baking,
 * astronomy, bicycle repair).
 */

export const channelId = (letter: string): string => `UC${letter.repeat(22)}`;
export const uploadsId = (letter: string): string => `UU${letter.repeat(22)}`;
export const videoId = (n: number): string => `vid${String(n).padStart(8, '0')}`;

const thumbnails = {
  default: { url: 'https://i.ytimg.com/vi/example/default.jpg', width: 120, height: 90 },
};

export function searchItem(n: number, letter: string, title: string): unknown {
  return {
    kind: 'youtube#searchResult',
    etag: `etag-search-${n}`,
    id: { kind: 'youtube#video', videoId: videoId(n) },
    snippet: {
      publishedAt: '2026-11-18T15:30:00Z',
      channelId: channelId(letter),
      title,
      description: 'A made-up description.',
      thumbnails,
      channelTitle: `Channel ${letter}`,
      liveBroadcastContent: 'none',
      publishTime: '2026-11-18T15:30:00Z',
    },
  };
}

export const SEARCH_REPLY = {
  kind: 'youtube#searchListResponse',
  etag: 'etag-search-list',
  nextPageToken: 'CDIQAA',
  regionCode: 'US',
  pageInfo: { totalResults: 1_000_000, resultsPerPage: 50 },
  items: [
    searchItem(1, 'A', 'Folding a paper crane in 40 seconds'),
    searchItem(2, 'B', 'Three-ingredient flatbread &amp; a hot pan'),
    // A channel result, which a video search should never return but is skipped if it does.
    {
      kind: 'youtube#searchResult',
      etag: 'etag-search-channel',
      id: { kind: 'youtube#channel', channelId: channelId('C') },
      snippet: { publishedAt: '2026-11-18T15:30:00Z', channelId: channelId('C'), title: 'C' },
    },
    searchItem(3, 'D', 'Why the moon looks bigger at the horizon'),
  ],
};

export function videoItem(n: number, letter: string, overrides: Record<string, unknown> = {}) {
  return {
    kind: 'youtube#video',
    etag: `etag-video-${n}`,
    id: videoId(n),
    snippet: {
      publishedAt: '2026-11-18T15:30:00Z',
      channelId: channelId(letter),
      title: 'Fixing a slipping bicycle chain',
      description: 'A made-up description.',
      thumbnails,
      channelTitle: `Channel ${letter}`,
      categoryId: '26',
      liveBroadcastContent: 'none',
      defaultLanguage: 'en',
      localized: { title: 'Fixing a slipping bicycle chain', description: '' },
      defaultAudioLanguage: 'en-GB',
    },
    contentDetails: {
      duration: 'PT42S',
      dimension: '2d',
      definition: 'hd',
      caption: 'false',
      licensedContent: false,
      contentRating: {},
      projection: 'rectangular',
    },
    statistics: {
      viewCount: '184223',
      likeCount: '9120',
      favoriteCount: '0',
      commentCount: '311',
    },
    ...overrides,
  };
}

export const videosReply = (items: readonly unknown[]) => ({
  kind: 'youtube#videoListResponse',
  etag: 'etag-video-list',
  items,
  pageInfo: { totalResults: items.length, resultsPerPage: items.length },
});

export function channelItem(letter: string, overrides: Record<string, unknown> = {}) {
  return {
    kind: 'youtube#channel',
    etag: `etag-channel-${letter}`,
    id: channelId(letter),
    snippet: {
      title: `Channel ${letter}`,
      description: 'A made-up channel.',
      customUrl: `@channel-${letter.toLowerCase()}`,
      publishedAt: '2026-09-01T10:00:00Z',
      thumbnails,
      localized: { title: `Channel ${letter}`, description: 'A made-up channel.' },
      country: 'GB',
    },
    contentDetails: { relatedPlaylists: { likes: '', uploads: uploadsId(letter) } },
    statistics: {
      viewCount: '123456',
      subscriberCount: '890',
      hiddenSubscriberCount: false,
      videoCount: '12',
    },
    ...overrides,
  };
}

export const channelsReply = (items: readonly unknown[]) => ({
  kind: 'youtube#channelListResponse',
  etag: 'etag-channel-list',
  pageInfo: { totalResults: items.length, resultsPerPage: 5 },
  items,
});

export function playlistReply(numbers: readonly number[], nextPageToken?: string) {
  return {
    kind: 'youtube#playlistItemListResponse',
    etag: 'etag-playlist-items',
    ...(nextPageToken === undefined ? {} : { nextPageToken }),
    pageInfo: { totalResults: 120, resultsPerPage: 50 },
    items: numbers.map((n) => ({
      kind: 'youtube#playlistItem',
      etag: `etag-item-${n}`,
      id: `playlist-item-${n}`,
      contentDetails: { videoId: videoId(n), videoPublishedAt: '2026-11-18T15:30:00Z' },
    })),
  };
}

export const PLAYLIST_NOT_FOUND = {
  error: {
    code: 404,
    message:
      "The playlist identified with the request's <code>playlistId</code> parameter cannot be found.",
    errors: [
      {
        message:
          "The playlist identified with the request's <code>playlistId</code> parameter cannot be found.",
        domain: 'youtube.playlistItem',
        reason: 'playlistNotFound',
        location: 'playlistId',
        locationType: 'parameter',
      },
    ],
  },
};

export const QUOTA_EXCEEDED = {
  error: {
    code: 403,
    message:
      'The request cannot be completed because you have exceeded your <a href="/youtube/v3/getting-started#quota">quota</a>.',
    errors: [
      {
        message: 'The request cannot be completed because you have exceeded your quota.',
        domain: 'youtube.quota',
        reason: 'quotaExceeded',
      },
    ],
  },
};

export const keyRefused = (key: string) => ({
  error: {
    code: 400,
    message: `API key not valid: ${key}. Please pass a valid API key.`,
    errors: [{ message: 'API key not valid.', domain: 'global', reason: 'badRequest' }],
    status: 'INVALID_ARGUMENT',
  },
});
