import { describe, expect, test } from 'vitest';
import {
  PATHS,
  VIEWS,
  breakdownHref,
  channelHref,
  myChannelHref,
  redirectOf,
  routeFromHash,
  routeHash,
  viewHref,
  type PlainView,
  type ViewId,
} from '../src/lib/routes';

const CHANNEL = 'UCHnyfMqiRRG1u-2MsSQLbXA';

/** Every address of the app before the five places, and the screen it must still open. */
const OLD_ADDRESSES: readonly (readonly [string, ViewId, string])[] = [
  ['#/', 'home', '#/today'],
  ['#/home', 'home', '#/today'],
  ['#/radar', 'radar', '#/discover/map'],
  ['#/what-changed', 'what-changed', '#/today/changes'],
  ['#/breakouts', 'breakouts', '#/discover/videos'],
  ['#/outlier-bank', 'outlier-bank', '#/discover/videos/bank'],
  ['#/same-topic', 'same-topic', '#/discover/channels/same-topic'],
  ['#/thumbnails', 'thumbnails', '#/my-channel/videos/thumbnails'],
  ['#/transfers', 'transfers', '#/discover/videos/other-languages'],
  ['#/niches', 'niches', '#/discover/channels/new-niches'],
  ['#/formats', 'formats', '#/style/library'],
  ['#/hooks', 'hooks', '#/style/library/hooks'],
  ['#/ideas', 'ideas', '#/create/ideas'],
  ['#/script', 'script', '#/create/scripts'],
  ['#/risk', 'risk', '#/create/scripts/check'],
  ['#/format', 'format', '#/style/my-format'],
  ['#/breakdown', 'breakdown', '#/discover/channels/study'],
  [`#/breakdown/${CHANNEL}`, 'breakdown', `#/discover/channels/study/${CHANNEL}`],
  ['#/video-breakdown', 'video-breakdown', '#/discover/videos/one-video'],
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

  test('keeps the channel a breakdown link names', () => {
    expect(routeFromHash(`#/breakdown/${CHANNEL}`).channelId).toBe(CHANNEL);
    expect(routeFromHash('#/breakdown/not-a-channel').channelId).toBeNull();
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

  test('an address no screen has is shown as Today', () => {
    expect(redirectOf('#/nowhere')).toBe('#/today');
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

describe('the addresses of a channel to study', () => {
  test('open the list, or one channel in it', () => {
    expect(routeFromHash('#/discover/channels/study')).toEqual({
      view: 'breakdown',
      channelId: null,
      anchor: null,
    });
    expect(routeFromHash(`#/discover/channels/study/${CHANNEL}`)).toEqual({
      view: 'breakdown',
      channelId: CHANNEL,
      anchor: null,
    });
    expect(routeFromHash('#/discover/channels/study/not-a-channel').channelId).toBeNull();
  });

  test('are made by one helper, for buttons anywhere in the app', () => {
    expect(breakdownHref()).toBe('#/discover/channels/study');
    expect(breakdownHref(CHANNEL)).toBe(`#/discover/channels/study/${CHANNEL}`);
    expect(breakdownHref('@handle')).toBe('#/discover/channels/study');
    expect(routeHash({ view: 'breakdown', channelId: CHANNEL, anchor: null })).toBe(
      `#/discover/channels/study/${CHANNEL}`,
    );
  });

  test('take the old in-page breakdown links there, not to Ask', () => {
    expect(routeFromHash('#breakdown').view).toBe('breakdown');
    expect(routeFromHash('#breakdown-parts').view).toBe('breakdown');
  });
});
