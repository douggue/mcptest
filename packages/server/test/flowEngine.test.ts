import type { MapSnapshot } from '@jgtube/core';
import { describe, expect, test } from 'vitest';
import { flowEngine, type FlowDeps } from '../src/flowEngine';

const MINE = `UC${'m'.repeat(22)}`;
const PEER = `UC${'p'.repeat(22)}`;
const OFF = `UC${'o'.repeat(22)}`;

const deps = (overrides: Partial<FlowDeps['repos']> = {}): FlowDeps => ({
  repos: {
    maps: {
      latestForCenter: (center: string) =>
        center === MINE ? ({ members: [{ channelId: PEER }] } as never) : null,
    },
    formulas: { list: () => [{}, {}] as never },
    concepts: { listForCenter: () => [{}, {}, {}] as never },
    scripts: { list: () => [{}] as never },
    breakdowns: {
      list: (id: string) =>
        (id === PEER || id === OFF ? [{ written: true }] : [{ written: false }]) as never,
    },
    notes: {
      find: (_channel: string, kind: string) => (kind === 'style-lock' ? ({} as never) : null),
    },
    ...overrides,
  },
  findSnapshot: () => ({ breakouts: [{}, {}, {}, {}] }) as unknown as MapSnapshot,
  hookCount: () => 12,
});

describe('how far the owner has come for the channel on screen', () => {
  test('counts what is stored at each step, breakdowns only of channels on its map', () => {
    expect(flowEngine(deps()).flowCounts(MINE)).toEqual({
      breakouts: 4,
      formulas: 2,
      hooks: 12,
      concepts: 3,
      scripts: 1,
      breakdowns: 1,
      thumbnailReview: false,
      styleLock: true,
    });
  });

  test('is nothing for a channel with no map', () => {
    expect(flowEngine(deps()).flowCounts(OFF)).toBeNull();
  });
});
