import { describe, expect, test } from 'vitest';
import { flowSteps, ideaFromTransfer, originLink, type FlowCounts } from '../src/lib/flow';

const counts: FlowCounts = {
  breakouts: 14,
  formulas: 3,
  hooks: 12,
  concepts: 1,
  scripts: 0,
  breakdowns: 2,
  thumbnailReview: true,
  styleLock: false,
};

describe('the flow strip', () => {
  test('names the five steps in order, each opening its view with what is stored', () => {
    expect(flowSteps(counts)).toEqual([
      {
        id: 'research',
        label: 'Research',
        view: 'breakouts',
        count: '14 breakouts',
        done: true,
      },
      {
        id: 'formats',
        label: 'Formats and hooks',
        view: 'formats',
        count: '3 formats · 12 hooks',
        done: true,
      },
      { id: 'ideas', label: 'Ideas', view: 'ideas', count: '1 concept', done: true },
      {
        id: 'script',
        label: 'Script',
        view: 'script',
        count: 'No scripts yet',
        done: false,
      },
      {
        id: 'breakdown',
        label: 'Breakdown',
        view: 'ask',
        count: '2 breakdowns',
        done: true,
      },
    ]);
  });

  test('says nothing is counted before the counts are read', () => {
    expect(flowSteps(null).map((step) => step.count)).toEqual(['', '', '', '', '']);
  });
});

describe('where a thing in the idea lab or the script writer came from', () => {
  test('links back to the view it came from', () => {
    expect(originLink('breakout')).toEqual({
      label: 'Breaking out right now',
      href: '#/breakouts',
    });
    expect(originLink('hook')).toEqual({ label: 'the hook library', href: '#/hooks' });
    expect(originLink('transfer')).toEqual({
      label: 'the transfer list',
      href: '#/transfers',
    });
    expect(originLink('formula')).toEqual({ label: 'Trending formats', href: '#/formats' });
    expect(originLink('breakdown')).toEqual({
      label: 'the channel breakdown',
      href: '#/ask',
    });
    expect(originLink('review')).toEqual({ label: 'the thumbnail review', href: '#/ask' });
  });
});

describe('concepts from a transfer opportunity', () => {
  const version = (videoId: string, channelId: string, views: number) => ({
    videoId,
    title: `Title ${videoId}`,
    channelId,
    channelTitle: `Channel ${channelId}`,
    views,
  });
  const idea = {
    key: 'why x left',
    template: 'why {place} left',
    versions: [version('aaaaaaaaaa1', 'UCoff', 9000), version('bbbbbbbbbb2', 'UCon', 5000)],
  };

  test('take its best version on this map as inspiration and its template as the format', () => {
    expect(ideaFromTransfer(idea, new Set(['UCon']))).toEqual({
      pick: {
        videoId: 'bbbbbbbbbb2',
        title: 'Title bbbbbbbbbb2',
        channelTitle: 'Channel UCon',
        modelOpening: false,
        from: 'transfer',
      },
      format: 'transfer:why x left',
      idea: { key: 'why x left', template: 'why {place} left' },
    });
  });

  test('take only the format when no version is on this map', () => {
    expect(ideaFromTransfer(idea, new Set(['UCelse'])).pick).toBeNull();
  });
});
