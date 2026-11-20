import { beforeEach, describe, expect, test } from 'vitest';
import { createToolHandlers, type ToolHandlers } from '../src/tools';
import {
  ALPHA_ID,
  BETA_ID,
  CENTER_ID,
  DROPPED_ID,
  FakeEngine,
  GIANT_ID,
  channel,
  channelVideos,
  jsonOf,
  niche,
  nicheList,
  snapshot,
  textOf,
} from './fakes';

const NEAR_ID = 'UCnnnnnnnnnnnnnnnnnnnnnn';
const NEARER_ID = 'UCmmmmmmmmmmmmmmmmmmmmmm';
const KEPT_ID = 'UCkkkkkkkkkkkkkkkkkkkkkk';

const nearMiss = (id: string, title: string, relevance: number) =>
  channel({ id, title, relevance, peer: false, outsideReason: 'titles', recentViews: 300_000 });

let engine: FakeEngine;
let tools: ToolHandlers;

beforeEach(() => {
  engine = new FakeEngine();
  tools = createToolHandlers({ engine, log: () => {} });
});

describe('get_near_misses', () => {
  beforeEach(() => {
    engine.stored = snapshot({
      channels: [
        channel(),
        // Kept by the owner: already counted as a look-alike, so not a candidate.
        channel({ id: KEPT_ID, title: 'Kept', outsideReason: 'titles', kept: true }),
        nearMiss(NEAR_ID, 'Near', 0.2149),
        {
          ...nearMiss(NEARER_ID, 'Nearer', 0.2851),
          subscribers: null,
          breakout: { videoId: 'mmmmmmmmmm1', title: 'A Hit', views: 70_000, score: 6.04 },
        },
        { ...nearMiss(DROPPED_ID, 'Dropped', 0.29), removed: true },
        channel({ id: GIANT_ID, title: 'Giant', peer: false, outsideReason: 'larger' }),
      ],
    });
    engine.storedVideos = { ...channelVideos(8), videos: [...channelVideos(8).videos].reverse() };
  });

  test('lists the channels rejected on titles alone, closest match first, with recent titles', async () => {
    const data = jsonOf(await tools.getNearMisses({ channel: '@mychannel' }));

    expect(data).toEqual({
      center: { id: CENTER_ID, title: 'My Channel' },
      shown: 2,
      nearMisses: [
        {
          id: NEARER_ID,
          title: 'Nearer',
          match: 29,
          recentViews: 300_000,
          best: { video: 'mmmmmmmmmm1', title: 'A Hit', views: 70_000, score: 6 },
          titles: ['Video 0', 'Video 1', 'Video 2', 'Video 3', 'Video 4'],
        },
        {
          id: NEAR_ID,
          title: 'Near',
          subs: 5000,
          match: 21,
          recentViews: 300_000,
          titles: ['Video 0', 'Video 1', 'Video 2', 'Video 3', 'Video 4'],
        },
      ],
    });
    // The titles are read from the store by channel id, only for the channels shown.
    expect(engine.lookups).toEqual(['@mychannel', NEARER_ID, NEAR_ID]);
  });

  test('caps the list and says how many more there are', async () => {
    const data = jsonOf(await tools.getNearMisses({ channel: '@mychannel', limit: 1 }));

    expect(data['shown']).toBe(1);
    expect(data['more']).toBe(1);
    expect(engine.lookups).toEqual(['@mychannel', NEARER_ID]);
  });

  test('a channel whose videos are no longer stored is listed without titles', async () => {
    engine.storedVideos = null;

    const data = jsonOf(await tools.getNearMisses({ channel: '@mychannel', limit: 1 }));

    expect((data['nearMisses'] as object[])[0]).not.toHaveProperty('titles');
  });

  test('says when no map exists', async () => {
    engine.stored = null;

    const result = await tools.getNearMisses({ channel: '@nobody' });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/^No map has been made/);
  });
});

describe('set_competitor_status', () => {
  test('records that the owner keeps a channel and says how it now counts', async () => {
    const result = await tools.setCompetitorStatus({
      center: '@mychannel',
      channel: GIANT_ID,
      status: 'kept',
    });

    expect(result.isError).toBeUndefined();
    expect(engine.statusCalls).toEqual([[CENTER_ID, GIANT_ID, 'kept']]);
    expect(jsonOf(result)).toEqual({
      center: { id: CENTER_ID, title: 'My Channel' },
      channel: { id: GIANT_ID, title: 'Giant' },
      status: 'kept',
      lookalike: true,
    });
  });

  test('finds the channel on the map by its handle, whatever the capitals', async () => {
    const result = await tools.setCompetitorStatus({
      center: CENTER_ID,
      channel: 'https://www.youtube.com/@ALPHA',
      status: 'removed',
    });

    expect(engine.statusCalls).toEqual([[CENTER_ID, ALPHA_ID, 'removed']]);
    expect(jsonOf(result)).toMatchObject({ status: 'removed', lookalike: false });
  });

  test('auto hands the decision back to the filter', async () => {
    const result = await tools.setCompetitorStatus({
      center: '@mychannel',
      channel: DROPPED_ID,
      status: 'auto',
    });

    expect(engine.statusCalls).toEqual([[CENTER_ID, DROPPED_ID, 'auto']]);
    expect(jsonOf(result)).toMatchObject({ status: 'auto', lookalike: true });
  });

  test.each([
    ['a handle that is not on the map', '@stranger', 0],
    ['an id that is not on the map', 'UCzzzzzzzzzzzzzzzzzzzzzz', 1],
    ['the centre itself', CENTER_ID, 1],
  ])('refuses %s', async (_what, ref, calls) => {
    const result = await tools.setCompetitorStatus({
      center: '@mychannel',
      channel: ref,
      status: 'kept',
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(
      'That channel is not on the latest map of this centre channel. Use get_map to see which are.',
    );
    expect(engine.statusCalls).toHaveLength(calls);
  });

  test('refuses a status it does not know, before anything is changed', async () => {
    const result = await tools.setCompetitorStatus({
      center: '@mychannel',
      channel: BETA_ID,
      status: 'deleted' as 'kept',
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('status is "kept", "removed" or "auto".');
    expect(engine.statusCalls).toEqual([]);
  });

  test('refuses text that is not a channel, and says when no map exists', async () => {
    const notChannel = await tools.setCompetitorStatus({
      center: '@mychannel',
      channel: 'not a channel!',
      status: 'kept',
    });
    engine.stored = null;
    const noMap = await tools.setCompetitorStatus({
      center: '@nobody',
      channel: BETA_ID,
      status: 'kept',
    });

    expect(textOf(notChannel)).toMatch(/^Not a valid YouTube channel/);
    expect(textOf(noMap)).toMatch(/^No map has been made/);
    expect(engine.statusCalls).toEqual([]);
  });
});

describe('list_niches', () => {
  test('lists new or small channels with a video that took off', async () => {
    const data = jsonOf(await tools.listNiches({}));

    expect(data).toEqual({
      checked: 320,
      smallMaxSubs: 10_000,
      newMaxAgeDays: 90,
      shown: 1,
      niches: [
        {
          id: ALPHA_ID,
          title: 'Alpha',
          handle: 'alpha',
          subs: 5000,
          recentViews: 420_000,
          uploads: 6,
          viewsPerSub: 84,
          earnsUsd: [840, 3360],
          channelAgeDays: 42,
          why: ['new', 'small'],
          hits: '2/9',
          top: [
            {
              video: 'aaaaaaaaaa1',
              title: 'America Just Built The Impossible',
              views: 90_000,
              score: 8.3,
            },
          ],
          titles: ['The Tunnel Nobody Wanted'],
        },
      ],
    });
  });

  test('marks watched channels, and ones that no longer meet the rule', async () => {
    engine.niches = nicheList([
      niche({
        watched: true,
        qualifies: false,
        subscribers: null,
        handle: null,
        viewsPerSubscriber: null,
        earnings: {
          low: 0,
          high: 2,
          longFormViews: 300,
          shortsViews: 0,
          belowAdThreshold: true,
        },
        channelAgeDays: null,
        reasons: [],
        outperformers: [],
        sampleTitles: [],
      }),
    ]);

    const data = jsonOf(await tools.listNiches({}));

    expect(data['niches']).toEqual([
      {
        id: ALPHA_ID,
        title: 'Alpha',
        recentViews: 420_000,
        uploads: 6,
        earnsUsd: [0, 2],
        notPaidYet: true,
        why: [],
        hits: '2/9',
        watched: true,
        qualifies: false,
        top: [],
      },
    ]);
  });

  test('caps the list, and can show only the watched ones', async () => {
    engine.niches = nicheList([
      niche(),
      niche({ id: BETA_ID, title: 'Beta', watched: true }),
      niche({ id: GIANT_ID, title: 'Gamma' }),
    ]);

    const cappedList = jsonOf(await tools.listNiches({ limit: 2 }));
    const watched = jsonOf(await tools.listNiches({ watched_only: true }));

    expect(cappedList['shown']).toBe(2);
    expect(cappedList['more']).toBe(1);
    expect((watched['niches'] as Array<{ id: string }>).map((entry) => entry.id)).toEqual([
      BETA_ID,
    ]);
    expect(watched).not.toHaveProperty('more');
  });

  test('refuses a limit outside the range', async () => {
    const result = await tools.listNiches({ limit: 0 });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('limit is a whole number from 1 to 50.');
  });
});
