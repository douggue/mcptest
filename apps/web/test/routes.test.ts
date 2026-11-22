import { describe, expect, test } from 'vitest';
import {
  VIEWS,
  breakdownHref,
  channelHref,
  routeFromHash,
  routeHash,
  viewHref,
} from '../src/lib/routes';

const CHANNEL = 'UCHnyfMqiRRG1u-2MsSQLbXA';

describe('a view address', () => {
  test('is the home view when the address names nothing', () => {
    for (const hash of ['', '#', '#/', '#/home']) {
      expect(routeFromHash(hash)).toEqual({ view: 'home', channelId: null, anchor: null });
    }
  });

  test('names each view after the slash', () => {
    expect(routeFromHash('#/ideas')).toEqual({ view: 'ideas', channelId: null, anchor: null });
    expect(routeFromHash('#/settings').view).toBe('settings');
    expect(routeFromHash('#/what-changed/').view).toBe('what-changed');
  });

  test("names one channel's view by its channel id", () => {
    expect(routeFromHash(`#/channel/${CHANNEL}`)).toEqual({
      view: 'channel',
      channelId: CHANNEL,
      anchor: null,
    });
  });

  test('falls back to home for an unknown view or a channel that is not a channel id', () => {
    expect(routeFromHash('#/nowhere').view).toBe('home');
    expect(routeFromHash('#/channel/not-an-id').view).toBe('home');
    expect(routeFromHash('#/channel').view).toBe('home');
  });

  test('takes an old in-page link to the view that holds the element, to scroll to it', () => {
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

  test('ignores an old link that no view holds, and anything that is not an element id', () => {
    expect(routeFromHash('#somewhere-else')).toEqual({
      view: 'home',
      channelId: null,
      anchor: null,
    });
    expect(routeFromHash('#<script>')).toMatchObject({ view: 'home', anchor: null });
  });
});

describe('the address of a view', () => {
  test('is the view after a slash, a channel by its id, and an element by its id', () => {
    expect(routeHash({ view: 'home', channelId: null, anchor: null })).toBe('#/');
    expect(routeHash({ view: 'ideas', channelId: null, anchor: null })).toBe('#/ideas');
    expect(routeHash({ view: 'channel', channelId: CHANNEL, anchor: null })).toBe(
      `#/channel/${CHANNEL}`,
    );
    expect(routeHash({ view: 'what-changed', channelId: null, anchor: 'alerts-title' })).toBe(
      '#alerts-title',
    );
    expect(viewHref('script')).toBe('#/script');
    expect(channelHref(CHANNEL)).toBe(`#/channel/${CHANNEL}`);
  });

  test('reads back as the same view', () => {
    for (const view of Object.keys(VIEWS) as (keyof typeof VIEWS)[]) {
      if (view === 'channel') continue;
      expect(routeFromHash(viewHref(view)).view).toBe(view);
    }
  });

  test('every view has a title', () => {
    for (const meta of Object.values(VIEWS)) expect(meta.title.length).toBeGreaterThan(0);
  });
});

describe('Breakdown’s addresses', () => {
  test('open the chooser, or one channel in it', () => {
    expect(routeFromHash('#/breakdown')).toEqual({
      view: 'breakdown',
      channelId: null,
      anchor: null,
    });
    expect(routeFromHash(`#/breakdown/${CHANNEL}`)).toEqual({
      view: 'breakdown',
      channelId: CHANNEL,
      anchor: null,
    });
    expect(routeFromHash('#/breakdown/not-a-channel').channelId).toBeNull();
    expect(routeFromHash('#/video-breakdown').view).toBe('video-breakdown');
  });

  test('are made by one helper, for buttons anywhere in the app', () => {
    expect(breakdownHref()).toBe('#/breakdown');
    expect(breakdownHref(CHANNEL)).toBe(`#/breakdown/${CHANNEL}`);
    expect(breakdownHref('@handle')).toBe('#/breakdown');
    expect(routeHash({ view: 'breakdown', channelId: CHANNEL, anchor: null })).toBe(
      `#/breakdown/${CHANNEL}`,
    );
  });

  test('take the old in-page breakdown links to Breakdown, not Ask AI', () => {
    expect(routeFromHash('#breakdown').view).toBe('breakdown');
    expect(routeFromHash('#breakdown-parts').view).toBe('breakdown');
  });
});
