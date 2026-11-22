import { describe, expect, test } from 'vitest';
import { DESTINATIONS, destinationHref, destinationOf, tabHref } from '../src/lib/sections';
import { VIEWS, type ViewId } from '../src/lib/routes';

const CENTER = 'UC0UJp3kmO7wf33XFf56gbTw';
const tabViews = (): readonly ViewId[] =>
  DESTINATIONS.flatMap((destination) => destination.tabs.map((tab) => tab.view));

describe('the rail and its destinations', () => {
  test('has six destinations, Home first, Breakdown between Create and Ask AI, Ask AI last', () => {
    expect(DESTINATIONS.map((d) => d.label)).toEqual([
      'Home',
      'Channel',
      'Research',
      'Create',
      'Breakdown',
      'Ask AI',
    ]);
  });

  test('gives Breakdown a Channel tab and a One video tab', () => {
    expect(destinationOf('breakdown')?.tabs.map((tab) => tab.label)).toEqual([
      'Channel',
      'One video',
    ]);
    expect(destinationOf('video-breakdown')?.id).toBe('breakdown');
  });

  test('puts every view but Home, Ask AI and Settings in exactly one tab', () => {
    const elsewhere: readonly ViewId[] = ['home', 'ask', 'settings'];
    const all = (Object.keys(VIEWS) as ViewId[]).filter((view) => !elsewhere.includes(view));

    expect(new Set(tabViews()).size).toBe(tabViews().length);
    expect([...tabViews()].sort()).toEqual([...all].sort());
  });

  test('keeps ideas and the script together under Create', () => {
    expect(destinationOf('ideas')?.id).toBe('create');
    expect(destinationOf('script')?.id).toBe('create');
    expect(destinationOf('risk')?.id).toBe('create');
  });

  test('finds the destination of every view, and none for Settings', () => {
    expect(destinationOf('home')?.id).toBe('home');
    expect(destinationOf('ask')?.id).toBe('ask');
    expect(destinationOf('channel')?.id).toBe('channel');
    expect(destinationOf('radar')?.id).toBe('channel');
    expect(destinationOf('hooks')?.id).toBe('research');
    expect(destinationOf('settings')).toBeNull();
  });
});

describe('where a tab and a destination lead', () => {
  test('the channel tab opens the map’s own channel, or Home with no map', () => {
    expect(tabHref('channel', CENTER)).toBe(`#/channel/${CENTER}`);
    expect(tabHref('channel', null)).toBe('#/');
    expect(tabHref('ideas', null)).toBe('#/ideas');
  });

  test('a destination opens its first tab or its one view', () => {
    const [home, channel, research, create, breakdown, ask] = DESTINATIONS;
    expect(breakdown && destinationHref(breakdown, null)).toBe('#/breakdown');
    expect(home && destinationHref(home, CENTER)).toBe('#/');
    expect(channel && destinationHref(channel, CENTER)).toBe(`#/channel/${CENTER}`);
    expect(research && destinationHref(research, CENTER)).toBe('#/breakouts');
    expect(create && destinationHref(create, null)).toBe('#/ideas');
    expect(ask && destinationHref(ask, null)).toBe('#/ask');
  });
});
