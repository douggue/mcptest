import { describe, expect, test } from 'vitest';
import { chooseComparison, titleWords } from '../src/thumbReview/compare';
import { boardOf, vid } from './thumbReviewFixtures';

const target = { videoId: vid('own', 1), title: 'Who invented the bicycle', channelId: 'UCowner' };

describe('titleWords', () => {
  test('keeps the words that carry the subject, lower case, without short or common ones', () => {
    expect([...titleWords('Who Invented THE Bicycle? (1817)')]).toEqual([
      'invented',
      'bicycle',
      '1817',
    ]);
  });
});

describe('chooseComparison', () => {
  test('puts winners on the same subject first, then the closest channels’ top winners', () => {
    // Arrange
    const board = boardOf([
      { winners: ['How fridges work', 'The first car'] },
      { winners: ['The bicycle that changed France', 'Steam engines'] },
    ]);

    // Act
    const set = chooseComparison(board, target);

    // Assert
    expect(set.winners.map((thumb) => thumb.videoId)).toEqual([
      vid('w1x', 0),
      vid('w0x', 0),
      vid('w0x', 1),
      vid('w1x', 1),
    ]);
    expect(set.winners[0]).toMatchObject({
      channelId: 'UCpeer1',
      channelTitle: 'Peer 1',
      score: 10,
      sameSubject: true,
    });
    expect(set.winners[1]?.sameSubject).toBe(false);
  });

  test('pairs each winner with an ordinary video of its own channel, each used once', () => {
    const board = boardOf([{ winners: ['A', 'B', 'C'], ordinary: 2 }]);

    const set = chooseComparison(board, target);

    expect(set.winners.map((thumb) => thumb.pairedWith)).toEqual([
      vid('o0x', 0),
      vid('o0x', 1),
      null,
    ]);
    expect(set.ordinary.map((thumb) => thumb.videoId)).toEqual([vid('o0x', 0), vid('o0x', 1)]);
  });

  test('takes at most three from one channel and twelve in all, and never the video itself', () => {
    const many = Array.from({ length: 6 }, () => ({ winners: ['a', 'b', 'c', 'd', 'e', 'f'] }));
    const board = boardOf(many);

    const set = chooseComparison(board, { ...target, videoId: vid('w0x', 0) });

    expect(set.winners).toHaveLength(12);
    const perChannel = new Map<string, number>();
    for (const thumb of set.winners) {
      perChannel.set(thumb.channelId, (perChannel.get(thumb.channelId) ?? 0) + 1);
    }
    expect(Math.max(...perChannel.values())).toBeLessThanOrEqual(3);
    expect(set.winners.map((thumb) => thumb.videoId)).not.toContain(vid('w0x', 0));
  });

  test('has no winners when the map has none', () => {
    expect(chooseComparison(boardOf([]), target).winners).toEqual([]);
  });
});
