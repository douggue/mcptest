import { describe, expect, test } from 'vitest';
import type { ComparisonSet, CompareThumb } from '../src/thumbReview/compare';
import { countComparison, missingValues } from '../src/thumbReview/count';
import type { ThumbTags } from '../src/thumbReview/tags';
import { TAGS } from './thumbReviewFixtures';

const thumb = (
  videoId: string,
  channelId: string,
  pairedWith: string | null = null,
): CompareThumb => ({
  videoId,
  channelId,
  channelTitle: channelId,
  title: videoId,
  score: 5,
  sameSubject: false,
  pairedWith,
});

/** Three channels, each with two winners and one ordinary video. */
const set: ComparisonSet = {
  winners: [
    thumb('w1', 'A', 'o1'),
    thumb('w2', 'A'),
    thumb('w3', 'B', 'o2'),
    thumb('w4', 'B'),
    thumb('w5', 'C', 'o3'),
    thumb('w6', 'C'),
  ],
  ordinary: [thumb('o1', 'A'), thumb('o2', 'B'), thumb('o3', 'C')],
};

const plain: ThumbTags = {
  ...TAGS,
  face: 'none',
  expression: 'none',
  textColour: 'white',
  colours: ['blue'],
  highlight: false,
  logo: false,
};

function tagsWith(
  winner: Partial<ThumbTags>,
  ordinary: Partial<ThumbTags> = {},
  extra: Record<string, ThumbTags> = {},
): ReadonlyMap<string, ThumbTags> {
  return new Map([
    ['mine', plain],
    ...['w1', 'w2', 'w3', 'w4', 'w5', 'w6'].map((id) => [id, { ...plain, ...winner }] as const),
    ...['o1', 'o2', 'o3'].map((id) => [id, { ...plain, ...ordinary }] as const),
    ...Object.entries(extra),
  ]);
}

const rowOf = (counted: ReturnType<typeof countComparison>, key: string, value: string) =>
  counted.rows.find((row) => row.key === key && row.value === value);

describe('countComparison', () => {
  test('finds a value the winners share across channels that ordinary videos and yours lack', () => {
    // Act
    const counted = countComparison(set, tagsWith({ face: 'large' }), 'mine');

    // Assert
    expect(rowOf(counted, 'face', 'large')).toMatchObject({
      winners: 6,
      winnersTagged: 6,
      winnerShare: 1,
      channels: 3,
      ordinary: 0,
      ordinaryShare: 0,
      yours: false,
      flag: null,
      winning: true,
      examples: ['w1', 'w2', 'w3'],
    });
    expect(rowOf(counted, 'face', 'large')?.lift).toBeGreaterThan(5);
    expect(missingValues(counted).map((row) => `${row.key}=${row.value}`)).toContain('face=large');
    expect(counted).toMatchObject({
      winnersTagged: 6,
      ordinaryTagged: 3,
      channels: 3,
      targetTagged: true,
    });
  });

  test('flags a value as the topic when ordinary videos show it as often', () => {
    const counted = countComparison(set, tagsWith({ face: 'large' }, { face: 'large' }), 'mine');
    expect(rowOf(counted, 'face', 'large')).toMatchObject({ flag: 'topic', winning: false });
  });

  test('flags a value one channel alone shows as that channel’s branding', () => {
    // Arrange: only channel A's winners carry a logo.
    const tags = new Map(tagsWith({}));
    tags.set('w1', { ...plain, logo: true });
    tags.set('w2', { ...plain, logo: true });

    // Act
    const counted = countComparison(set, tags, 'mine');

    // Assert
    expect(rowOf(counted, 'logo', 'yes')).toMatchObject({
      channels: 1,
      flag: 'branding',
      winning: false,
    });
  });

  test('weights each channel equally, so one channel with many winners cannot carry a value', () => {
    // Arrange: channel A has five more winners, all with a split frame.
    const many: ComparisonSet = {
      winners: [...set.winners, ...['x1', 'x2', 'x3', 'x4', 'x5'].map((id) => thumb(id, 'A'))],
      ordinary: set.ordinary,
    };
    const extra = Object.fromEntries(
      ['x1', 'x2', 'x3', 'x4', 'x5'].map((id) => [id, { ...plain, split: true }]),
    );
    const tags = new Map(tagsWith({}, {}, extra));
    tags.set('w1', { ...plain, split: true });
    tags.set('w2', { ...plain, split: true });

    // Act
    const row = rowOf(countComparison(many, tags, 'mine'), 'split', 'yes');

    // Assert: 7 of 11 winners, but one channel in three.
    expect(row?.winners).toBe(7);
    expect(row?.winnerShare).toBeCloseTo(1 / 3, 5);
  });

  test('marks what your thumbnail already has, and counts only what was tagged', () => {
    const tags = new Map(tagsWith({ colours: ['blue'] }));
    tags.delete('w6');
    tags.delete('o3');

    const counted = countComparison(set, tags, 'mine');

    expect(rowOf(counted, 'colours', 'blue')).toMatchObject({ yours: true, winnersTagged: 5 });
    expect(missingValues(counted).some((row) => row.value === 'blue')).toBe(false);
    expect(counted.ordinaryTagged).toBe(2);
  });

  test('says your thumbnail was not tagged, and still counts the winners', () => {
    const counted = countComparison(set, tagsWith({ face: 'large' }), 'not-tagged');
    expect(counted.targetTagged).toBe(false);
    expect(rowOf(counted, 'face', 'large')?.yours).toBe(false);
  });

  test('has no share for ordinary videos when none was tagged', () => {
    const counted = countComparison({ ...set, ordinary: [] }, tagsWith({ face: 'large' }), 'mine');
    expect(rowOf(counted, 'face', 'large')).toMatchObject({
      ordinaryShare: null,
      lift: null,
      winning: true,
    });
  });
});
