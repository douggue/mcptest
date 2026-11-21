import { describe, expect, test } from 'vitest';
import { TAG_ATTRIBUTES, parseTagAnswer, tagValues } from '../src/thumbReview/tags';
import { TAGS } from './thumbReviewFixtures';

const A = 'aaaaaaaaaaa';
const B = 'bbbbbbbbbbb';

describe('parseTagAnswer', () => {
  test('keeps each asked thumbnail whose tags pass the fixed checklist', () => {
    // Arrange
    const answer = `Here you go:\n${JSON.stringify([{ id: A, ...TAGS }])}\nDone.`;

    // Act
    const parsed = parseTagAnswer(answer, [A]);

    // Assert
    expect(parsed.tags.get(A)).toEqual(TAGS);
    expect(parsed.rejected).toEqual([]);
  });

  test('records, never keeps, a thumbnail off the checklist, missing, or not asked about', () => {
    // Arrange
    const answer = JSON.stringify([
      { id: A, ...TAGS, face: 'enormous' },
      { id: 'ccccccccccc', ...TAGS },
    ]);

    // Act
    const parsed = parseTagAnswer(answer, [A, B]);

    // Assert
    expect(parsed.tags.size).toBe(0);
    expect(parsed.rejected).toEqual([
      { videoId: A, reason: 'face is not one of the fixed values' },
      { videoId: B, reason: 'not tagged' },
    ]);
  });

  test('refuses extra fields, too many colours and a description that runs on', () => {
    const extra = parseTagAnswer(JSON.stringify([{ id: A, ...TAGS, mood: 'calm' }]), [A]);
    const colours = parseTagAnswer(
      JSON.stringify([{ id: A, ...TAGS, colours: ['red', 'blue', 'green', 'black'] }]),
      [A],
    );
    const long = parseTagAnswer(
      JSON.stringify([{ id: A, ...TAGS, description: 'x'.repeat(400) }]),
      [A],
    );
    expect([extra, colours, long].map((parsed) => parsed.tags.size)).toEqual([0, 0, 0]);
  });

  test('treats an answer with no JSON list as every thumbnail untagged', () => {
    expect(parseTagAnswer('I could not see them.', [A]).rejected).toEqual([
      { videoId: A, reason: 'the answer held no list of tags' },
    ]);
    expect(parseTagAnswer('[not json]', [A]).rejected[0]?.reason).toBe(
      'the answer held no list of tags',
    );
  });
});

describe('tagValues', () => {
  test('reads each attribute as the values counted, words in bands and yes or no for marks', () => {
    const values = Object.fromEntries(
      TAG_ATTRIBUTES.map((attribute) => [attribute.key, tagValues(TAGS, attribute.key)]),
    );
    expect(values).toMatchObject({
      face: ['large'],
      words: ['3-4'],
      colours: ['yellow', 'black'],
      highlight: ['yes'],
      split: ['no'],
      clutter: ['1'],
    });
    expect(tagValues({ ...TAGS, words: 0 }, 'words')).toEqual(['none']);
    expect(tagValues({ ...TAGS, words: 2 }, 'words')).toEqual(['1-2']);
    expect(tagValues({ ...TAGS, words: 9 }, 'words')).toEqual(['5+']);
  });

  test('has a plain label for every attribute and leaves the description out of counting', () => {
    expect(TAG_ATTRIBUTES.map((attribute) => attribute.key)).not.toContain('description');
    expect(TAG_ATTRIBUTES.every((attribute) => attribute.label.length > 0)).toBe(true);
  });
});
