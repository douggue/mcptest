import { describe, expect, test } from 'vitest';
import {
  PLACES,
  isOwnChannel,
  leadOf,
  pageTitle,
  placeHref,
  screenHref,
  tabHref,
  whereIs,
  whereOf,
} from '../src/lib/places';
import { VIEWS, routeFromHash, type Route, type ViewId } from '../src/lib/routes';

const CENTER = 'UC0UJp3kmO7wf33XFf56gbTw';
const OTHER = 'UCHnyfMqiRRG1u-2MsSQLbXA';
const at = (view: ViewId, channelId: string | null = null): Route => ({
  view,
  channelId,
  anchor: null,
});
const placed = (): readonly ViewId[] =>
  PLACES.flatMap((place) => place.tabs.flatMap((tab) => tab.screens.map((each) => each.view)));

describe('the five places', () => {
  test('are Today, Discover, Create, Style and My channel, in that order', () => {
    expect(PLACES.map((place) => place.label)).toEqual([
      'Today',
      'Discover',
      'Create',
      'Style',
      'My channel',
    ]);
    expect(PLACES.map((place) => place.short)).toEqual([
      'Today',
      'Discover',
      'Create',
      'Style',
      'Channel',
    ]);
  });

  test('hold the approved tabs', () => {
    const tabs = Object.fromEntries(
      PLACES.map((place) => [place.id, place.tabs.map((tab) => tab.label)]),
    );
    expect(tabs).toEqual({
      today: ['Next step', 'Since your last look'],
      discover: ['Videos', 'Channels', 'Map'],
      create: ['Ideas', 'Scripts', 'Plan'],
      style: ['My format', 'Library', 'Bible'],
      'my-channel': ['Overview', 'Videos', 'Results', 'Breakdown'],
    });
  });

  test('put every screen but Ask, Settings and the design sheet in exactly one tab', () => {
    const apart: readonly ViewId[] = ['ask', 'settings', 'design-system'];
    const all = (Object.keys(VIEWS) as ViewId[]).filter((view) => !apart.includes(view));
    expect(new Set(placed()).size).toBe(placed().length);
    expect([...placed()].sort()).toEqual([...all].sort());
    for (const view of apart) expect(whereOf(view)).toBeNull();
  });

  test('keep every feature of the old menu under its new place', () => {
    const place = (view: ViewId): string | undefined => whereOf(view)?.place.id;
    const tab = (view: ViewId): string | undefined => whereOf(view)?.tab.label;
    expect([place('home'), place('what-changed')]).toEqual(['today', 'today']);
    for (const view of ['breakouts', 'outlier-bank', 'transfers', 'video-breakdown'] as const) {
      expect([place(view), tab(view)]).toEqual(['discover', 'Videos']);
    }
    for (const view of ['competitors', 'niches', 'same-topic', 'breakdown'] as const) {
      expect([place(view), tab(view)]).toEqual(['discover', 'Channels']);
    }
    expect([place('radar'), tab('radar')]).toEqual(['discover', 'Map']);
    expect([place('comments'), tab('comments')]).toEqual(['create', 'Ideas']);
    expect([place('risk'), tab('risk')]).toEqual(['create', 'Scripts']);
    expect([place('calendar'), tab('calendar')]).toEqual(['create', 'Plan']);
    expect([place('formats'), tab('hooks')]).toEqual(['style', 'Library']);
    expect([place('format'), place('bible')]).toEqual(['style', 'style']);
    expect([place('own-videos'), tab('thumbnails')]).toEqual(['my-channel', 'Videos']);
    expect([place('pacing'), tab('pacing')]).toEqual(['my-channel', 'Results']);
    expect(place('own-breakdown')).toBe('my-channel');
  });

  test('name a screen as its pill names it', () => {
    expect(whereOf('niches')?.screen.label).toBe('New niches');
    expect(whereOf('channel')?.screen.label).toBe('Overview');
  });
});

describe('where the screen on show sits', () => {
  test('the owner’s own channel is My channel, named or not', () => {
    expect(isOwnChannel(at('channel'), null)).toBe(true);
    expect(isOwnChannel(at('channel', CENTER), CENTER)).toBe(true);
    expect(isOwnChannel(at('channel', OTHER), CENTER)).toBe(false);
    expect(isOwnChannel(at('ideas'), CENTER)).toBe(false);
    expect(whereIs(at('channel', CENTER), CENTER)?.place.id).toBe('my-channel');
  });

  test('another channel’s page sits in Discover, under Channels', () => {
    const where = whereIs(at('channel', OTHER), CENTER);
    expect([where?.place.id, where?.tab.label]).toEqual(['discover', 'Channels']);
  });

  test('every other screen sits where it is listed', () => {
    expect(whereIs(at('hooks'), CENTER)?.place.id).toBe('style');
    expect(whereIs(at('settings'), CENTER)).toBeNull();
  });
});

describe('where the menu leads', () => {
  test('a place opens its first tab, a tab its first screen, a pill its screen', () => {
    expect(PLACES.map(placeHref)).toEqual([
      '#/today',
      '#/discover/videos',
      '#/create/ideas',
      '#/style/my-format',
      '#/my-channel',
    ]);
    const channels = PLACES[1]?.tabs[1];
    expect(channels && tabHref(channels)).toBe('#/discover/channels');
    expect(tabHref({ label: 'Empty', screens: [] })).toBe('#/today');
    expect(placeHref({ ...PLACES[0]!, tabs: [] })).toBe('#/today');
    expect(screenHref('niches')).toBe('#/discover/channels/new-niches');
    expect(screenHref('channel')).toBe('#/my-channel');
  });

  test('every tab and pill leads to a screen of its own place', () => {
    for (const place of PLACES) {
      for (const tab of place.tabs) {
        for (const each of tab.screens) {
          const route = routeFromHash(screenHref(each.view));
          expect(route.view).toBe(each.view);
          expect(whereIs(route, null)?.place.id).toBe(place.id);
        }
      }
    }
  });
});

describe('the words around a screen', () => {
  test('the lead names the owner’s channel when there is one', () => {
    const discover = PLACES[1]!;
    expect(leadOf(discover, 'Sample')).toBe('What is working around Sample right now.');
    expect(leadOf(discover, null)).toBe('What is working around your channel right now.');
  });

  test('the browser tab names the screen, then its place', () => {
    expect(pageTitle(at('home'), null)).toBe('Next step · Today · Jgtube');
    expect(pageTitle(at('what-changed'), null)).toBe('Since your last look · Today · Jgtube');
    expect(pageTitle(at('breakouts'), null)).toBe('Breaking out · Videos · Discover · Jgtube');
    expect(pageTitle(at('radar'), null)).toBe('Map · Discover · Jgtube');
    expect(pageTitle(at('ideas'), null)).toBe('Ideas · Create · Jgtube');
    expect(pageTitle(at('calendar'), null)).toBe('Plan · Create · Jgtube');
    expect(pageTitle(at('hooks'), null)).toBe('Hooks · Library · Style · Jgtube');
    expect(pageTitle(at('channel'), null)).toBe('Overview · My channel · Jgtube');
    expect(pageTitle(at('channel', OTHER), CENTER)).toBe('Channel · Discover · Jgtube');
    expect(pageTitle(at('settings'), null)).toBe('Settings · Jgtube');
    expect(pageTitle(at('ask'), null)).toBe('Ask · Jgtube');
  });
});
