import { describe, expect, test } from 'vitest';
import { OVERVIEW_ITEM, RAIL_GROUPS } from '../src/lib/sections';
import { VIEWS, type ViewId } from '../src/lib/routes';

const railViews = (): readonly ViewId[] =>
  RAIL_GROUPS.flatMap((group) => group.items.map((item) => item.view));

describe('the left rail', () => {
  test('groups the views under Research, Create and Study, each once', () => {
    expect(RAIL_GROUPS.map((group) => group.label)).toEqual(['Research', 'Create', 'Study']);
    expect(new Set(railViews()).size).toBe(railViews().length);
    expect(RAIL_GROUPS[1]?.items.map((item) => item.label)).toEqual([
      'Trending formats',
      'Hook library',
      'Idea lab',
      'Script writer',
      'Check before publishing',
    ]);
    expect(RAIL_GROUPS[2]?.items.map((item) => item.label)).toEqual([
      'Ask AI and breakdowns',
      'Your videos against the plan',
      'Upload calendar',
      'Length and pacing',
      'What viewers ask for',
    ]);
  });

  test('opens every view but the overview, settings and a channel, which open elsewhere', () => {
    const elsewhere: readonly ViewId[] = ['home', 'settings', 'channel'];
    const all = (Object.keys(VIEWS) as ViewId[]).filter((view) => !elsewhere.includes(view));

    expect([...railViews()].sort()).toEqual([...all].sort());
    expect(OVERVIEW_ITEM.view).toBe('home');
  });
});
