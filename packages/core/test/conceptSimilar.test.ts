import { describe, expect, test } from 'vitest';
import { closeIdea, closeTitles, subjectWords } from '../src/concepts/similar';

describe('whether two ideas are close, from the words of their titles', () => {
  test('reads the words that carry a subject: no case, punctuation or common words', () => {
    expect([...subjectWords('Why the Old Bridge’s Cables Are Still Holding!')]).toEqual([
      'old',
      'bridge',
      'cables',
      'holding',
    ]);
  });

  test('two titles that share most of their subject words are close, whatever the wording around them', () => {
    expect(
      closeTitles('The Bridge Cables That Never Rusted', 'Why These Bridge Cables Never Rusted'),
    ).toBe(true);
    expect(closeTitles('The Tunnel Nobody Finished', 'The Bridge Nobody Finished')).toBe(false);
    expect(closeTitles('Old Bridge', 'The Old Bridge')).toBe(false);
  });

  test('an idea is close to the earliest stored idea it shares a subject with, by title or alternate', () => {
    const stored = [
      { id: 5, title: 'The Bridge Cables That Never Rusted', altTitles: [] },
      {
        id: 9,
        title: 'A Lighthouse Without a Keeper',
        altTitles: ['Why These Bridge Cables Never Rusted'],
      },
      { id: 12, title: 'Bridge Cables That Never Rusted, Explained', altTitles: [] },
    ];

    expect(closeIdea(stored[2] ?? { id: 0, title: '' }, stored)?.id).toBe(5);
    expect(closeIdea(stored[1] ?? { id: 0, title: '' }, stored)?.id).toBe(5);
    expect(closeIdea(stored[0] ?? { id: 0, title: '' }, stored)).toBeNull();
    expect(closeIdea({ id: 20, title: 'The Harbour That Moved Inland' }, stored)).toBeNull();
  });
});
