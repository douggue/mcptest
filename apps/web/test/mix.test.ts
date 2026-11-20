import type { SnapshotChannel } from '@jgtube/core';
import { describe, expect, test } from 'vitest';
import { GROUP_LABEL, describeGroup, describeMix } from '../src/lib/mix';

type Mixed = Pick<
  SnapshotChannel,
  'peer' | 'removed' | 'group' | 'ninetyDayViews' | 'widelySeenUploads'
>;

const lookalike = (group: SnapshotChannel['group'], overrides: Partial<Mixed> = {}): Mixed => ({
  peer: true,
  removed: false,
  group,
  ninetyDayViews: 1_240_000,
  widelySeenUploads: 5,
  ...overrides,
});

const many = (count: number, group: SnapshotChannel['group']): Mixed[] =>
  Array.from({ length: count }, () => lookalike(group));

describe('describeMix', () => {
  test('states the split of the look-alikes in words', () => {
    const channels = [...many(15, 'taken-off'), ...many(5, 'rising'), ...many(2, 'neither')];

    expect(describeMix(channels)).toBe('22 like yours: 15 taken off, 5 rising, 2 neither');
  });

  test('counts only the look-alikes the owner has not removed', () => {
    const channels = [
      lookalike('taken-off'),
      lookalike('taken-off', { removed: true }),
      lookalike('rising', { peer: false }),
    ];

    expect(describeMix(channels)).toBe('1 like yours: 1 taken off, 0 rising');
  });

  test('says the actual split when a map has little of one group', () => {
    expect(describeMix(many(9, 'taken-off'))).toBe('9 like yours: 9 taken off, 0 rising');
    expect(describeMix([...many(1, 'rising'), ...many(3, 'neither')])).toBe(
      '4 like yours: 0 taken off, 1 rising, 3 neither',
    );
  });

  test('says nothing when no channel is like the centre', () => {
    expect(describeMix([lookalike('rising', { peer: false })])).toBeNull();
  });
});

describe('the group of one look-alike', () => {
  test('has a short label', () => {
    expect(GROUP_LABEL).toEqual({ 'taken-off': 'Taken off', rising: 'Rising', neither: 'Neither' });
  });

  test('is explained with the figures it rests on', () => {
    expect(describeGroup(lookalike('taken-off'))).toBe(
      'Taken off: 5 of its uploads in the last 90 days passed 10K views, 1.2M views in all.',
    );
    expect(describeGroup(lookalike('rising'))).toBe(
      'Rising: its first upload is under three months old and it is already far above its size, with small totals so far.',
    );
    expect(
      describeGroup(lookalike('neither', { widelySeenUploads: 1, ninetyDayViews: 14_000 })),
    ).toBe(
      'Neither taken off nor rising: 1 of its uploads in the last 90 days passed 10K views, 14K views in all.',
    );
  });
});
