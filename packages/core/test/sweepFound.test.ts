import { describe, expect, test } from 'vitest';
import { openDatabase } from '../src/db/sqlite';
import { SqliteSweepRepo } from '../src/repos/sqliteSweepRepo';
import { foundReader, latestFinished } from '../src/sweep/found';
import type { SweepSummary } from '../src/sweep/types';

const NOW = new Date('2026-11-20T12:00:00Z');
const cid = (letter: string) => `UC${letter.repeat(22)}`;
const SUMMARY = {
  keywords: [],
  newNiches: 0,
  keywordsLeft: 0,
  problems: [],
} as unknown as SweepSummary;

function setup() {
  const sweeps = new SqliteSweepRepo(openDatabase(':memory:'));
  const first = sweeps.begin({ startedBy: 'owner', via: 'pages', startedAt: NOW });
  sweeps.finish(first, { stopped: 'done', message: null, summary: SUMMARY, finishedAt: NOW });
  const find = {
    sweepId: first,
    keywordId: null,
    keyword: null,
    fromChannelId: null,
    qualified: true,
    foundAt: NOW,
  };
  sweeps.recordFind({ ...find, channelId: cid('A'), source: 'keyword', keyword: 'lost cities' });
  sweeps.recordFind({ ...find, channelId: cid('B'), source: 'snowball', fromChannelId: cid('A') });
  sweeps.recordFind({ ...find, channelId: cid('G'), source: 'snowball', fromChannelId: cid('Z') });
  const deps = {
    sweeps,
    titleOf: (id: string) => (id === cid('A') ? 'Channel A' : null),
    onAMap: () => [cid('A'), cid('M')],
  };
  return { sweeps, deps, first };
}

describe('how a niche channel was found', () => {
  test('by a keyword, by the snowball from a named channel, on a map, or not said', () => {
    const { deps } = setup();
    const { foundOf, lastSweepAt } = foundReader(deps);
    expect(lastSweepAt).toEqual(NOW);
    // The sweep's record wins over the map the channel was later put on.
    expect(foundOf(cid('A'))).toEqual({
      foundBy: { kind: 'keyword', keyword: 'lost cities' },
      newSinceSweep: true,
    });
    expect(foundOf(cid('B')).foundBy).toEqual({
      kind: 'snowball',
      fromChannelId: cid('A'),
      fromTitle: 'Channel A',
    });
    expect(foundOf(cid('G')).foundBy).toMatchObject({ kind: 'snowball', fromTitle: null });
    expect(foundOf(cid('M'))).toEqual({ foundBy: { kind: 'map' }, newSinceSweep: false });
    expect(foundOf(cid('X'))).toEqual({ foundBy: null, newSinceSweep: false });
  });

  test('new since the last sweep means the latest finished one, not one still running', () => {
    const { sweeps, deps, first } = setup();
    sweeps.begin({ startedBy: 'owner', via: 'pages', startedAt: new Date(NOW.getTime() + 1000) });
    expect(latestFinished(sweeps)?.id).toBe(first);
    expect(foundReader(deps).foundOf(cid('A')).newSinceSweep).toBe(true);
    const later = sweeps.begin({ startedBy: 'owner', via: 'pages', startedAt: NOW });
    sweeps.finish(later, { stopped: 'done', message: null, summary: SUMMARY, finishedAt: NOW });
    expect(foundReader(deps).foundOf(cid('A')).newSinceSweep).toBe(false);
  });

  test('nothing is new before any sweep', () => {
    const sweeps = new SqliteSweepRepo(openDatabase(':memory:'));
    const reader = foundReader({ sweeps, titleOf: () => null, onAMap: () => [] });
    expect(reader.lastSweepAt).toBeNull();
    expect(reader.foundOf(cid('A'))).toEqual({ foundBy: null, newSinceSweep: false });
  });
});
