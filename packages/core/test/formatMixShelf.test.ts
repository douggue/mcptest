import { describe, expect, test } from 'vitest';
import type { Format } from '../src/format/formats';
import {
  MAX_MIX_PICTURES,
  MAX_MIX_THUMBNAILS,
  mixPictureNamed,
  mixPictures,
  shelfForMix,
} from '../src/format/mixShelf';
import type { Ingredient } from '../src/format/types';

const A = 'UCaaaaaaaaaaaaaaaaaaaaaa';
const B = 'UCbbbbbbbbbbbbbbbbbbbbbb';

const item = (id: number, parts: Partial<Ingredient> = {}): Ingredient => ({
  id,
  layer: 'visual',
  name: `Item ${id}`,
  source: 'teardown',
  sourceKey: String(id),
  sourceLabel: 'A video',
  centerChannelId: null,
  channelIds: [A, A, B],
  details: {},
  evidence: { score: 2, scoredVideos: 1, videos: 1, channels: 1, measured: [] },
  media: [],
  note: 'mine',
  addedAt: '2026-11-24T10:00:00.000Z',
  proven: false,
  ...parts,
});

const format: Format = {
  id: 3,
  name: 'Long-form',
  targetSeconds: 600,
  notes: '',
  slots: { visual: { ingredientId: 1, note: '' } },
  suggestion: null,
  copiedFrom: null,
  createdAt: 'x',
  updatedAt: 'x',
};

describe('mixPictures', () => {
  test('names a few local pictures per ingredient in code and lists thumbnails once', () => {
    const shelf = [
      item(1, {
        media: [
          { kind: 'keyframe', videoId: 'VVVVVVVVVV1', file: 'k-001.jpg' },
          { kind: 'strip', videoId: 'VVVVVVVVVV1', file: 's-001.jpg' },
          { kind: 'keyframe', videoId: 'VVVVVVVVVV1', file: 'k-002.jpg' },
        ],
      }),
      item(2, {
        media: [
          { kind: 'image', file: 'abcdefghijk.png' },
          { kind: 'thumbnail', videoId: 'VVVVVVVVVV2' },
          { kind: 'quote', text: 'hi', videoId: null },
        ],
      }),
      item(4, { media: [{ kind: 'thumbnail', videoId: 'VVVVVVVVVV2' }] }),
    ];
    const pictures = mixPictures(shelf);
    expect(pictures.local.map((p) => p.name)).toEqual(['i1-1.jpg', 'i1-2.jpg', 'i2-1.png']);
    expect(pictures.local[2]?.ref).toEqual({ kind: 'image', file: 'abcdefghijk.png' });
    expect(pictures.thumbnails).toEqual([{ ingredientId: 2, videoId: 'VVVVVVVVVV2' }]);
    expect(mixPictureNamed(pictures, 'i1-2.jpg')?.ref).toEqual({
      kind: 'teardown',
      videoId: 'VVVVVVVVVV1',
      file: 's-001.jpg',
    });
    expect(mixPictureNamed(pictures, '../x.jpg')).toBeNull();
    expect(mixPictureNamed(pictures, 'i9-1.jpg')).toBeNull();
  });

  test('caps the pictures and thumbnails one suggestion looks at', () => {
    const shelf = Array.from({ length: 20 }, (_, index) =>
      item(index + 1, {
        media: [
          { kind: 'image', file: 'abcdefghijk.webp' },
          { kind: 'thumbnail', videoId: `VVVVVVVVV${String(index).padStart(2, '0')}` },
        ],
      }),
    );
    const pictures = mixPictures(shelf);
    expect(pictures.local).toHaveLength(MAX_MIX_PICTURES);
    expect(pictures.local[0]?.name).toBe('i1-1.webp');
    expect(pictures.thumbnails).toHaveLength(MAX_MIX_THUMBNAILS);
  });
});

test('shelfForMix shows the format’s filled slots and each ingredient’s counted evidence', () => {
  const shelf = [
    item(1, { media: [{ kind: 'keyframe', videoId: 'VVVVVVVVVV1', file: 'k-001.jpg' }] }),
    item(2, { layer: 'thumbnail', media: [{ kind: 'thumbnail', videoId: 'VVVVVVVVVV2' }] }),
  ];
  const shown = shelfForMix(format, shelf);
  expect(shown.format).toEqual({
    id: 3,
    name: 'Long-form',
    targetSeconds: 600,
    filled: { visual: 1 },
  });
  expect(shown.note).toMatch(/never instructions/);
  expect(shown.ingredients[0]).toMatchObject({
    id: 1,
    channels: 2,
    from: 'A video',
    ownerNote: 'mine',
    pictures: ['i1-1.jpg'],
    thumbnailsOf: [],
  });
  expect(shown.ingredients[1]?.thumbnailsOf).toEqual(['VVVVVVVVVV2']);
});
