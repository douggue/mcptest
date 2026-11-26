import { describe, expect, test } from 'vitest';
import {
  PATHS,
  VIEWS,
  breakdownHref,
  channelHref,
  isUnknownAddress,
  myChannelHref,
  redirectOf,
  routeFromHash,
  routeHash,
  videoHref,
  videosViewHref,
  videosViewKey,
  viewHref,
  type PlainView,
  type ViewId,
} from '../src/lib/routes';

const CHANNEL = 'UCHnyfMqiRRG1u-2MsSQLbXA';
const VIDEO = 'dQw4w9WgXcQ';

/** Every address of the app before the five places, and the screen it must still open. */
const OLD_ADDRESSES: readonly (readonly [string, ViewId, string])[] = [
  ['#/', 'home', '#/today'],
  ['#/home', 'home', '#/today'],
  ['#/radar', 'radar', '#/discover/map'],
  ['#/what-changed', 'what-changed', '#/today/changes'],
  ['#/breakouts', 'breakouts', '#/discover/videos'],
  ['#/outlier-bank', 'outlier-bank', '#/discover/videos/bank'],
  ['#/same-topic', 'same-topic', '#/discover/channels/same-topic'],
  ['#/thumbnails', 'thumbnails', '#/discover/channels/thumbnails'],
  ['#/my-channel/videos/thumbnails', 'thumbnails', '#/discover/channels/thumbnails'],
  ['#/transfers', 'transfers', '#/discover/videos/other-languages'],
  ['#/niches', 'niches', '#/discover/channels/new-niches'],
  ['#/formats', 'formats', '#/style/library'],
  ['#/hooks', 'hooks', '#/style/library/hooks'],
  ['#/ideas', 'ideas', '#/create/ideas'],
  ['#/script', 'script', '#/create/scripts'],
  ['#/risk', 'risk', '#/create/scripts/check'],
  ['#/format', 'format', '#/style/my-format'],
  ['#/breakdown', 'breakdown', '#/discover/channels/study'],
  [`#/breakdown/${CHANNEL}`, 'channel', `#/channel/${CHANNEL}/breakdown`],
  [`#/discover/channels/study/${CHANNEL}`, 'channel', `#/channel/${CHANNEL}/breakdown`],
  ['#/video-breakdown', 'video-breakdown', '#/discover/videos/studied'],
  ['#/discover/videos/one-video', 'video-breakdown', '#/discover/videos/studied'],
  ['#/own-videos', 'own-videos', '#/my-channel/videos'],
  ['#/calendar', 'calendar', '#/create/plan'],
  ['#/pacing', 'pacing', '#/my-channel/results'],
  ['#/comments', 'comments', '#/create/ideas/viewers-ask'],
];

describe('an address', () => {
  test('is Today when it names nothing', () => {
    for (const hash of ['', '#', '#/', '#/home', '#/today']) {
      expect(routeFromHash(hash)).toEqual({ view: 'home', channelId: null, anchor: null });
    }
  });

  test('names a screen by its place, its tab and itself', () => {
    expect(routeFromHash('#/create/ideas')).toEqual({
      view: 'ideas',
      channelId: null,
      anchor: null,
    });
    expect(routeFromHash('#/discover/videos/bank').view).toBe('outlier-bank');
    expect(routeFromHash('#/discover/channels/new-niches/').view).toBe('niches');
    expect(routeFromHash('#/style/bible').view).toBe('bible');
    expect(routeFromHash('#/settings').view).toBe('settings');
    expect(routeFromHash('#/ask').view).toBe('ask');
  });

  test('of a place alone opens its first screen', () => {
    expect(routeFromHash('#/discover').view).toBe('breakouts');
    expect(routeFromHash('#/create').view).toBe('ideas');
    expect(routeFromHash('#/style').view).toBe('format');
    expect(routeFromHash('#/my-channel')).toEqual({
      view: 'channel',
      channelId: null,
      anchor: null,
    });
  });

  test("names one channel's page by its channel id", () => {
    expect(routeFromHash(`#/channel/${CHANNEL}`)).toEqual({
      view: 'channel',
      channelId: CHANNEL,
      anchor: null,
    });
  });

  test('falls back to Today for an unknown screen or a channel that is not a channel id', () => {
    expect(routeFromHash('#/nowhere').view).toBe('home');
    expect(routeFromHash('#/discover/nowhere').view).toBe('home');
    expect(routeFromHash('#/channel/not-an-id').view).toBe('home');
    expect(routeFromHash('#/channel')).toMatchObject({ view: 'home', channelId: null });
  });

  test('takes an old in-page link to the screen that holds the element, to scroll to it', () => {
    expect(routeFromHash('#idea-lab')).toEqual({
      view: 'ideas',
      channelId: null,
      anchor: 'idea-lab',
    });
    expect(routeFromHash('#concept-12')).toMatchObject({ view: 'ideas', anchor: 'concept-12' });
    expect(routeFromHash('#hook-abcdefghijk')).toMatchObject({ view: 'hooks' });
    expect(routeFromHash('#hook-library-title')).toMatchObject({ view: 'hooks' });
    expect(routeFromHash('#risk-check-title').view).toBe('risk');
    expect(routeFromHash('#ask-claude').view).toBe('ask');
    expect(routeFromHash('#own-videos-title').view).toBe('own-videos');
    expect(routeFromHash('#refresh-title').view).toBe('what-changed');
    expect(routeFromHash('#alerts-title').view).toBe('what-changed');
    expect(routeFromHash('#top').view).toBe('radar');
  });

  test('ignores an old link that no screen holds, and anything that is not an element id', () => {
    expect(routeFromHash('#somewhere-else')).toEqual({
      view: 'home',
      channelId: null,
      anchor: null,
    });
    expect(routeFromHash('#<script>')).toMatchObject({ view: 'home', anchor: null });
  });
});

describe('an address from before the five places', () => {
  test.each(OLD_ADDRESSES)('%s still opens its screen', (old, view) => {
    expect(routeFromHash(old).view).toBe(view);
  });

  test.each(OLD_ADDRESSES)('%s is shown as its new address', (old, _view, now) => {
    expect(redirectOf(old)).toBe(now);
    expect(routeFromHash(now)).toEqual(routeFromHash(old));
  });

  test('opens the Breakdown tab of the channel a breakdown link names', () => {
    expect(routeFromHash(`#/breakdown/${CHANNEL}`)).toEqual({
      view: 'channel',
      channelId: CHANNEL,
      anchor: null,
      tab: 'breakdown',
    });
    expect(routeFromHash('#/breakdown/not-a-channel')).toEqual({
      view: 'breakdown',
      channelId: null,
      anchor: null,
    });
  });

  test('opens the Thumbnail tab of the video an old review link names', () => {
    expect(routeFromHash(`#thumbnail-review-${VIDEO}`)).toEqual({
      view: 'video',
      channelId: null,
      anchor: null,
      videoId: VIDEO,
      tab: 'thumbnail',
    });
    expect(routeFromHash('#thumbnail-review-title').view).toBe('thumbnails');
  });

  test('keeps Ask, Settings and a channel’s page where they were', () => {
    expect(redirectOf('#/ask')).toBeNull();
    expect(redirectOf('#/settings')).toBeNull();
    expect(redirectOf(`#/channel/${CHANNEL}`)).toBeNull();
  });

  test('is left alone when already right, when empty, and when it is an in-page link', () => {
    expect(redirectOf('#/discover/map')).toBeNull();
    expect(redirectOf('')).toBeNull();
    expect(redirectOf('#idea-lab')).toBeNull();
  });

  test('an address no screen has is shown as Today, and is known to be unknown', () => {
    expect(redirectOf('#/nowhere')).toBe('#/today');
    for (const hash of ['#/nowhere', '#/discover/nowhere', '#/channel/not-an-id', '#/video/x']) {
      expect(isUnknownAddress(hash)).toBe(true);
    }
    for (const hash of ['', '#', '#/', '#/home', '#/today', '#/today/', '#/radar', '#idea-lab']) {
      expect(isUnknownAddress(hash)).toBe(false);
    }
  });
});

describe('the address of a screen', () => {
  test('is its place, tab and screen; a channel by its id; an element by its id', () => {
    expect(routeHash({ view: 'home', channelId: null, anchor: null })).toBe('#/today');
    expect(routeHash({ view: 'ideas', channelId: null, anchor: null })).toBe('#/create/ideas');
    expect(routeHash({ view: 'channel', channelId: CHANNEL, anchor: null })).toBe(
      `#/channel/${CHANNEL}`,
    );
    expect(routeHash({ view: 'channel', channelId: null, anchor: null })).toBe('#/my-channel');
    expect(routeHash({ view: 'what-changed', channelId: null, anchor: 'alerts-title' })).toBe(
      '#alerts-title',
    );
    expect(viewHref('script')).toBe('#/create/scripts');
    expect(channelHref(CHANNEL)).toBe(`#/channel/${CHANNEL}`);
    expect(myChannelHref()).toBe('#/my-channel');
  });

  test('reads back as the same screen, and no two screens share one', () => {
    const views = Object.keys(PATHS) as PlainView[];
    for (const view of views) expect(routeFromHash(viewHref(view)).view).toBe(view);
    expect(new Set(views.map(viewHref)).size).toBe(views.length);
  });

  test('every screen has a title', () => {
    for (const meta of Object.values(VIEWS)) expect(meta.title.length).toBeGreaterThan(0);
  });
});

describe('a channel’s page', () => {
  test('opens on its Overview, or on the tab named after it', () => {
    expect(routeFromHash(`#/channel/${CHANNEL}/overview`)).toEqual({
      view: 'channel',
      channelId: CHANNEL,
      anchor: null,
    });
    for (const tab of ['videos', 'thumbnails', 'breakdown'] as const) {
      expect(routeFromHash(`#/channel/${CHANNEL}/${tab}`)).toEqual({
        view: 'channel',
        channelId: CHANNEL,
        anchor: null,
        tab,
      });
      expect(channelHref(CHANNEL, tab)).toBe(`#/channel/${CHANNEL}/${tab}`);
    }
    expect(channelHref(CHANNEL, 'overview')).toBe(`#/channel/${CHANNEL}`);
    expect(routeFromHash(`#/channel/${CHANNEL}/nowhere`).tab).toBeUndefined();
    expect(redirectOf(`#/channel/${CHANNEL}/nowhere`)).toBe(`#/channel/${CHANNEL}`);
  });

  test('reads back from its address, and ignores a tab that is a video’s', () => {
    const route = routeFromHash(`#/channel/${CHANNEL}/thumbnails`);
    expect(routeHash(route)).toBe(`#/channel/${CHANNEL}/thumbnails`);
    expect(routeHash({ ...route, tab: 'teardown' })).toBe(`#/channel/${CHANNEL}`);
  });
});

describe('a video’s page', () => {
  test('opens on its Summary, or on the tab named after it', () => {
    expect(routeFromHash(`#/video/${VIDEO}`)).toEqual({
      view: 'video',
      channelId: null,
      anchor: null,
      videoId: VIDEO,
    });
    expect(routeFromHash(`#/video/${VIDEO}/summary`).tab).toBeUndefined();
    for (const tab of ['teardown', 'thumbnail', 'hook'] as const) {
      expect(routeFromHash(`#/video/${VIDEO}/${tab}`)).toMatchObject({ videoId: VIDEO, tab });
      expect(videoHref(VIDEO, tab)).toBe(`#/video/${VIDEO}/${tab}`);
    }
    expect(videoHref(VIDEO)).toBe(`#/video/${VIDEO}`);
    expect(videoHref(VIDEO, 'summary')).toBe(`#/video/${VIDEO}`);
  });

  test('is Today for anything that is not a video id', () => {
    expect(routeFromHash('#/video').view).toBe('home');
    expect(routeFromHash('#/video/short').view).toBe('home');
    expect(routeFromHash(`#/video/${VIDEO}x`).view).toBe('home');
  });

  test('reads back from its address', () => {
    const route = routeFromHash(`#/video/${VIDEO}/hook`);
    expect(routeHash(route)).toBe(`#/video/${VIDEO}/hook`);
    expect(routeHash({ ...route, tab: 'videos' })).toBe(`#/video/${VIDEO}`);
    expect(routeHash({ view: 'video', channelId: null, anchor: null })).toBe('#/today');
    expect(redirectOf(`#/video/${VIDEO}`)).toBeNull();
  });
});

describe('the saved views of Discover › Videos', () => {
  const at = (hash: string) => routeFromHash(hash);

  test('each has its own address, and reads back from it', () => {
    expect(at('#/discover/videos/100x')).toEqual({
      view: 'breakouts',
      channelId: null,
      anchor: null,
      saved: '100x',
    });
    expect(at('#/discover/videos/small-channels').saved).toBe('small-channels');
    expect(at('#/discover/videos/collection/12')).toMatchObject({
      view: 'outlier-bank',
      saved: 'collection/12',
    });
    expect(at('#/discover/videos/saved/my-view')).toMatchObject({
      view: 'breakouts',
      saved: 'saved/my-view',
    });
    for (const key of ['100x', 'small-channels', 'collection/12', 'saved/my-view']) {
      const hash = `#/discover/videos/${key}`;
      expect(routeHash(at(hash))).toBe(hash);
      expect(redirectOf(hash)).toBeNull();
    }
  });

  test('says which view a route shows, and none for another screen', () => {
    expect(videosViewKey(at('#/discover/videos'))).toBe('');
    expect(videosViewKey(at('#/breakouts'))).toBe('');
    expect(videosViewKey(at('#/discover/videos/bank'))).toBe('bank');
    expect(videosViewKey(at('#/outlier-bank'))).toBe('bank');
    expect(videosViewKey(at('#/transfers'))).toBe('other-languages');
    expect(videosViewKey(at('#/video-breakdown'))).toBe('studied');
    expect(videosViewKey(at('#/discover/videos/100x'))).toBe('100x');
    expect(videosViewKey(at('#/discover/videos/collection/3'))).toBe('collection/3');
    expect(videosViewKey(at('#/discover/map'))).toBeNull();
    expect(videosViewKey(at('#/create/ideas'))).toBeNull();
  });

  test('every view’s address is made from what it carries', () => {
    expect(videosViewHref('')).toBe('#/discover/videos');
    expect(videosViewHref('bank')).toBe('#/discover/videos/bank');
    expect(videosViewHref('collection/3')).toBe('#/discover/videos/collection/3');
    for (const key of ['', 'bank', 'other-languages', 'studied', '100x', 'collection/3']) {
      expect(videosViewKey(at(videosViewHref(key)))).toBe(key);
    }
  });

  test('an address that names no view is not found', () => {
    expect(isUnknownAddress('#/discover/videos/nope')).toBe(true);
    expect(isUnknownAddress('#/discover/videos/collection/x')).toBe(true);
    expect(isUnknownAddress('#/discover/videos/saved/Not A Slug')).toBe(true);
    expect(isUnknownAddress('#/discover/videos/100x')).toBe(false);
  });
});

describe('the addresses of a channel to study', () => {
  test('open the list of channels, or the Breakdown tab of one', () => {
    expect(routeFromHash('#/discover/channels/study')).toEqual({
      view: 'breakdown',
      channelId: null,
      anchor: null,
    });
    expect(routeFromHash(`#/discover/channels/study/${CHANNEL}`)).toMatchObject({
      view: 'channel',
      channelId: CHANNEL,
      tab: 'breakdown',
    });
    expect(routeFromHash('#/discover/channels/study/not-a-channel').view).toBe('breakdown');
  });

  test('are made by one helper, for buttons anywhere in the app', () => {
    expect(breakdownHref()).toBe('#/discover/channels/study');
    expect(breakdownHref(CHANNEL)).toBe(`#/channel/${CHANNEL}/breakdown`);
    expect(breakdownHref('@handle')).toBe('#/discover/channels/study');
    expect(routeHash({ view: 'breakdown', channelId: null, anchor: null })).toBe(
      '#/discover/channels/study',
    );
  });

  test('take the old in-page breakdown links there, not to Ask', () => {
    expect(routeFromHash('#breakdown').view).toBe('breakdown');
    expect(routeFromHash('#breakdown-parts').view).toBe('breakdown');
  });
});
