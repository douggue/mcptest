import { describe, expect, test } from 'vitest';
import { channelFacts, type ChannelVideoInput } from '../src/teardown/channelFacts';
import { titleFacts } from '../src/teardown/titlePatterns';
import { MEASURED } from './teardownFixture';

describe('titleFacts', () => {
  test('counts each pattern over winners and ordinary titles, with lengths and repeated openings', () => {
    const facts = titleFacts(
      [
        'Why Japan Built 10,000 Bunkers?',
        'Why Nobody Lives Here - The Truth',
        'The MOST Dangerous Road in 2024',
        'Why You Never Hear About This $5 Trick',
      ],
      ['a quiet little walk', 'my day at the lake', 'how we cook rice'],
    );
    const pattern = (key: string) => facts.patterns.find((item) => item.key === key);
    expect(facts.winners).toBe(4);
    expect(facts.ordinary).toBe(3);
    expect(pattern('number')).toMatchObject({ winners: 3, ordinary: 0 });
    expect(pattern('year')).toMatchObject({ winners: 1 });
    expect(pattern('money')).toMatchObject({ winners: 1 });
    expect(pattern('question')).toMatchObject({ winners: 1 });
    expect(pattern('split')).toMatchObject({ winners: 1 });
    expect(pattern('caps')).toMatchObject({ winners: 1 });
    expect(pattern('named')).toMatchObject({ winners: 4, ordinary: 0 });
    expect(pattern('you')).toMatchObject({ winners: 1 });
    expect(pattern('me')).toMatchObject({ ordinary: 2 });
    expect(pattern('superlative')).toMatchObject({ winners: 1 });
    expect(pattern('charged')).toMatchObject({ winners: 4, ordinary: 1 });
    expect(pattern('exclamation')).toMatchObject({ winners: 0 });
    expect(facts.medianWords.ordinary).toBe(4);
    expect(facts.openings).toEqual([]);
    expect(titleFacts(['Why a', 'Why a b', 'x'], ['why a']).openings).toEqual([
      { words: 'why a', winners: 2, ordinary: 1 },
    ]);
  });
});

describe('channelFacts', () => {
  const video = (over: Partial<ChannelVideoInput>): ChannelVideoInput => ({
    videoId: 'aaaaaaaaaaa',
    title: 'A',
    role: 'winner',
    views: 1000,
    score: 5,
    measured: MEASURED,
    lines: [
      { at: 1, text: 'This is how it starts. One person.' },
      { at: 70, text: 'It ends.' },
    ],
    heardBy: null,
    thumbnail: { face: 'none', colours: ['red', 'black'], words: 3, description: 'x' },
    ...over,
  });

  test('sets the winners beside the ordinary videos, counted in code', () => {
    const facts = channelFacts({
      titles: { winners: ['Why it fell'], ordinary: ['a walk'] },
      videos: [
        video({ heardBy: 'agy' }),
        video({
          videoId: 'bbbbbbbbbbb',
          role: 'ordinary',
          measured: null,
          lines: null,
          thumbnail: null,
        }),
      ],
    });
    expect(facts.basis).toEqual({
      winners: 1,
      ordinary: 1,
      measured: 1,
      totalMinutes: 2,
      cutsMeasured: 5,
      withTranscript: 1,
      heardWithSound: [{ videoId: 'aaaaaaaaaaa', by: 'agy' }],
      framesOnly: [],
    });
    expect(facts.winners).toMatchObject({
      measured: 1,
      medianCutsPerMinute: 2.5,
      medianShotSeconds: 15,
      medianIntegratedLufs: -16,
      medianTransitionsPerMinute: 0.5,
      medianAnimationsPerMinute: 0.5,
      transitions: { cut: 5, dissolve: 1 },
    });
    expect(facts.ordinary).toMatchObject({
      measured: 0,
      medianCutsPerMinute: null,
      transitions: {},
    });
    expect(facts.palette.items.map((colour) => colour.hex)).toEqual(['#0A0B0E', '#E63946']);
    expect(facts.thumbnails.tagged).toEqual({ winners: 1, ordinary: 0 });
    expect(facts.thumbnails.counts['colours']).toEqual({
      red: { winners: 1, ordinary: 0 },
      black: { winners: 1, ordinary: 0 },
    });
    expect(facts.thumbnails.counts['description']).toBeUndefined();
    const first = facts.videos[0];
    expect(first?.hook).toMatchObject({
      seconds: 60,
      words: 7,
      firstLine: 'This is how it starts. One person.',
    });
    expect(first?.words?.hammers.map((line) => line.text)).toEqual([
      'This is how it starts.',
      'One person.',
      'It ends.',
    ]);
    expect(first?.pictures).toMatchObject({
      hookSheet: 'hook.jpg',
      strips: [{ name: 's-001.jpg', kind: 'animation' }],
    });
    expect(facts.videos[1]).toMatchObject({ measured: false, pace: null, words: null, hook: null });
    expect(facts.titles.winners).toBe(1);
  });
});
