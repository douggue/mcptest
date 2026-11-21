import { describe, expect, test } from 'vitest';
import { namedIds, pointOf, videoIndex, withoutRefs, type NamedVideo } from '../src/lib/videoRefs';

const video = (id: string, title = `Title ${id}`): NamedVideo => ({
  videoId: id,
  title,
  channelId: 'UCaaaaaaaaaaaaaaaaaaaaaa',
  channelTitle: 'Channel A',
  views: 1200,
});

const A = 'aaaaaaaaaa1';
const B = 'bbbbbbbbbb2';
const MADE_UP = 'zzzzzzzzzz9';

describe('a point of an answer that names videos', () => {
  test('keeps the words and lists the named videos that are stored, in the order named', () => {
    const known = videoIndex([video(A), video(B)]);

    const point = pointOf(`Dark photo, red words [video:${B}] [video:${A}]`, known);

    expect(point.text).toBe('Dark photo, red words');
    expect(point.videos.map((entry) => entry.videoId)).toEqual([B, A]);
  });

  test('drops an id that is not a stored video of the map, so a made-up one is never shown', () => {
    const point = pointOf(
      `Pale [video:${MADE_UP}] and plain [video:${A}].`,
      videoIndex([video(A)]),
    );

    expect(point.text).toBe('Pale and plain.');
    expect(point.videos.map((entry) => entry.videoId)).toEqual([A]);
  });

  test('shows a point with no markers as it stands, with no videos', () => {
    expect(pointOf('No video here.', videoIndex([]))).toEqual({
      text: 'No video here.',
      videos: [],
    });
  });

  test('names each video once even when the point names it twice', () => {
    const point = pointOf(`[video:${A}] then [video:${A}]`, videoIndex([video(A)]));

    expect(point.videos).toHaveLength(1);
  });
});

describe('the ids an answer names', () => {
  test('are each id once, in order, and none for an answer with no markers', () => {
    expect(namedIds(`x [video:${A}] y [video:${B}] [video:${A}]`)).toEqual([A, B]);
    expect(namedIds('nothing')).toEqual([]);
  });

  test('stop at the most one lookup takes', () => {
    const many = Array.from({ length: 100 }, (_, n) => `[video:${String(n).padStart(11, 'x')}]`);

    expect(namedIds(many.join(' '))).toHaveLength(80);
  });
});

describe('a text with its markers taken out', () => {
  test('reads as plain words, for copying', () => {
    expect(withoutRefs(`Model this one [video:${A}].`)).toBe('Model this one.');
  });
});
