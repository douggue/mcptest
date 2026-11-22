import { describe, expect, test } from 'vitest';
import type { ChannelChoice } from '../src/lib/breakdown';
import {
  MIN_STORED_VIDEOS,
  NO_FILTERS,
  brokenDownText,
  closenessWord,
  filterCandidates,
  isDue,
  mergeCandidates,
  metaLine,
  reasonFor,
  suggestedPicks,
  type Candidate,
  type CandidateFacts,
  type Closeness,
} from '../src/lib/breakdownPicks';

const NOW = new Date('2026-11-21T12:00:00Z');
const id = (letter: string): string => `UC${letter.repeat(22)}`;

const facts = (letter: string, extra: Partial<CandidateFacts> = {}): CandidateFacts => ({
  id: id(letter),
  title: `Channel ${letter.toUpperCase()}`,
  handle: `@chan${letter}`,
  logoUrl: null,
  subscribers: 5000,
  storedVideos: 40,
  breakingOut: 1,
  recentBest: 3,
  top: [],
  brokenDownAt: null,
  ...extra,
});

const candidate = (
  letter: string,
  closeness: Closeness | null,
  extra: Partial<CandidateFacts> = {},
): Candidate => ({
  ...facts(letter, extra),
  group: 'map',
  label: `Channel ${letter.toUpperCase()}`,
  closeness,
  own: false,
});

describe('the channels on offer', () => {
  test('carry their facts, where they come from and how close they are; channels not stored are left out', () => {
    const choices: ChannelChoice[] = [
      { id: id('a'), title: 'A', label: 'Your channel: A', group: 'map' },
      { id: id('b'), title: 'B', label: 'B', group: 'map' },
      { id: id('c'), title: 'C', label: 'C', group: 'niches' },
    ];

    const merged = mergeCandidates(
      choices,
      [facts('b'), facts('a')],
      new Map([[id('b'), 'close' as const]]),
      id('a'),
    );

    expect(merged.map((entry) => [entry.label, entry.closeness, entry.own])).toEqual([
      ['Your channel: A', null, true],
      ['B', 'close', false],
    ]);
  });
});

describe('the channels suggested to break down', () => {
  test('put the closest look-alikes with the most and strongest breakouts first, each with its reason', () => {
    const picks = suggestedPicks(
      [
        candidate('f', 'far', { breakingOut: 5, recentBest: 9 }),
        candidate('c', 'close', { breakingOut: 2, recentBest: 4 }),
        candidate('d', 'close', { breakingOut: 3, recentBest: 12 }),
        candidate('m', 'medium', { breakingOut: 1, recentBest: 2.5 }),
      ],
      NOW,
    );

    expect(picks.map((pick) => pick.candidate.title)).toEqual([
      'Channel D',
      'Channel C',
      'Channel F',
    ]);
    expect(picks[0]?.reason).toBe(
      'Close look-alike · 3 breaking out, best 12× usual · 40 videos stored · never broken down',
    );
  });

  test('leave out the owner’s own, thin channels, quiet ones and fresh breakdowns, but take old ones back', () => {
    const own = { ...candidate('o', 'close'), own: true };
    const picks = suggestedPicks(
      [
        own,
        candidate('t', 'close', { storedVideos: MIN_STORED_VIDEOS - 1 }),
        candidate('q', 'close', { breakingOut: 0, recentBest: null }),
        candidate('r', 'close', { brokenDownAt: '2026-11-01T00:00:00Z' }),
        candidate('s', 'close', { brokenDownAt: '2026-06-01T00:00:00Z' }),
      ],
      NOW,
    );

    expect(picks.map((pick) => pick.candidate.title)).toEqual(['Channel S']);
    expect(picks[0]?.reason).toMatch(/last broken down 173 days ago$/);
  });

  test('say plainly when a channel is not on this map and nothing is breaking out', () => {
    expect(reasonFor(candidate('x', null, { breakingOut: 0, recentBest: null }), NOW)).toBe(
      'Not on this map · nothing breaking out this month · 40 videos stored · never broken down',
    );
    expect(isDue(candidate('x', null, { brokenDownAt: '2026-11-20T00:00:00Z' }), NOW)).toBe(false);
  });
});

describe('searching and filtering the channels', () => {
  const all = [
    candidate('a', 'close', { title: 'Map Stories', breakingOut: 0, recentBest: null }),
    candidate('b', 'medium', { handle: '@historymaps' }),
    candidate('c', 'close', { brokenDownAt: '2026-10-01T00:00:00Z' }),
  ];
  const titles = (list: readonly Candidate[]) => list.map((entry) => entry.title);

  test('finds a channel by its name or handle, whatever the case', () => {
    expect(titles(filterCandidates(all, { ...NO_FILTERS, query: ' map ' }))).toEqual([
      'Map Stories',
      'Channel B',
    ]);
    expect(titles(filterCandidates(all, NO_FILTERS))).toHaveLength(3);
  });

  test('keeps the close ones only, those breaking out, or those not broken down yet', () => {
    expect(titles(filterCandidates(all, { ...NO_FILTERS, closeOnly: true }))).toEqual([
      'Map Stories',
      'Channel C',
    ]);
    expect(titles(filterCandidates(all, { ...NO_FILTERS, hasBreakouts: true }))).toEqual([
      'Channel B',
      'Channel C',
    ]);
    expect(titles(filterCandidates(all, { ...NO_FILTERS, notBrokenDown: true }))).toEqual([
      'Map Stories',
      'Channel B',
    ]);
  });
});

describe('the words on a channel’s row', () => {
  test('label every number and date', () => {
    expect(metaLine(facts('a'))).toEqual(['5K subscribers', '1 breaking out']);
    expect(metaLine(facts('a', { subscribers: null }))[0]).toBe('Subscribers hidden');
    expect(brokenDownText('2026-11-03T10:00:00Z')).toBe('Broken down 3 Nov 2026');
    expect(brokenDownText(null)).toBe('');
    expect(closenessWord('medium')).toBe('Medium');
  });
});
