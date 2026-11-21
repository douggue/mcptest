import { describe, expect, test } from 'vitest';
import { RAIL_GROUPS, collapsedFrom, collapsedText, withCollapsed } from '../src/lib/sections';

describe('the left rail', () => {
  test('groups the sections under Research, Create and Study, each once', () => {
    expect(RAIL_GROUPS.map((group) => group.label)).toEqual(['Research', 'Create', 'Study']);
    const targets = RAIL_GROUPS.flatMap((group) => group.items.map((item) => item.target));
    expect(new Set(targets).size).toBe(targets.length);
    expect(RAIL_GROUPS[1]?.items.map((item) => item.label)).toEqual([
      'Trending formats',
      'Hook library',
      'Idea lab',
      'Script writer',
    ]);
    expect(RAIL_GROUPS[2]?.items.map((item) => item.label)).toEqual(['Ask AI and breakdowns']);
  });
});

describe('the sections the owner closed', () => {
  test('are remembered as a list of ids, and read back the same', () => {
    const closed = withCollapsed(withCollapsed(new Set(), 'idea-lab', true), 'formulas', true);

    expect(collapsedFrom(collapsedText(closed))).toEqual(new Set(['idea-lab', 'formulas']));
    expect(withCollapsed(closed, 'idea-lab', false)).toEqual(new Set(['formulas']));
  });

  test('read from nothing, or from anything that is not such a list, are none', () => {
    expect(collapsedFrom(null)).toEqual(new Set());
    expect(collapsedFrom('not json')).toEqual(new Set());
    expect(collapsedFrom('{"a":1}')).toEqual(new Set());
    expect(collapsedFrom('[1, "ok", "<bad id>"]')).toEqual(new Set(['ok']));
  });
});
