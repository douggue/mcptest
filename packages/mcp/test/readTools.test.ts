import { beforeEach, describe, expect, test } from 'vitest';
import { createToolHandlers, type ToolHandlers } from '../src/tools';
import {
  ALPHA_ID,
  BETA_ID,
  CENTER_ID,
  FakeEngine,
  GIANT_ID,
  board,
  channel,
  channelVideos,
  jsonOf,
  snapshot,
  textOf,
} from './fakes';

let engine: FakeEngine;
let tools: ToolHandlers;
let logged: string[];

beforeEach(() => {
  engine = new FakeEngine();
  logged = [];
  tools = createToolHandlers({ engine, log: (line) => logged.push(line) });
});

describe('get_map', () => {
  test('returns the centre, the counts and the look-alike channels', async () => {
    const result = await tools.getMap({ channel: '@mychannel' });

    expect(result.isError).toBeUndefined();
    expect(engine.lookups).toEqual(['@mychannel']);
    expect(jsonOf(result)).toEqual({
      map: { id: 7, made: '2026-11-20T05:10:00.000Z', depth: 2, region: 'US' },
      center: { id: CENTER_ID, title: 'My Channel', handle: 'mychannel', subs: 1200, videos: 12 },
      counts: {
        channels: 4,
        lookalikes: 2,
        others: 1,
        nearMisses: 0,
        removed: 1,
        breakouts: 2,
        otherBreakouts: 1,
      },
      lookalikes: [
        {
          id: ALPHA_ID,
          title: 'Alpha',
          subs: 5000,
          match: 62,
          tier: 'close',
          rising: true,
          best: {
            video: 'aaaaaaaaaa1',
            title: 'America Just Built The Impossible',
            views: 90_000,
            score: 8.3,
          },
        },
        { id: BETA_ID, title: 'Beta', match: 41, tier: 'medium' },
      ],
    });
  });

  test('leaves absent optional data out instead of sending nulls', async () => {
    const text = textOf(await tools.getMap({ channel: '@mychannel', include_others: true }));

    expect(text).not.toContain('null');
    expect(text).not.toContain('\n');
  });

  test('names the model channel when the map has one', async () => {
    engine.stored = snapshot({ model: { id: BETA_ID, title: 'Beta' } });

    const data = jsonOf(await tools.getMap({ channel: CENTER_ID }));

    expect(data['model']).toEqual({ id: BETA_ID, title: 'Beta' });
  });

  test('includes the channels that are not look-alikes, with the reason, when asked', async () => {
    const data = jsonOf(await tools.getMap({ channel: '@mychannel', include_others: true }));

    expect(data['others']).toEqual([
      { id: GIANT_ID, title: 'Giant', subs: 9_000_000, match: 10, tier: 'far', why: 'larger' },
    ]);
  });

  test('marks a channel the owner kept, and counts the ones left out on titles alone', async () => {
    engine.stored = snapshot({
      channels: [
        channel({ outsideReason: 'titles', kept: true }),
        channel({ id: BETA_ID, title: 'Beta', peer: false, outsideReason: 'titles' }),
      ],
    });

    const data = jsonOf(await tools.getMap({ channel: '@mychannel' }));

    expect((data['lookalikes'] as object[])[0]).toMatchObject({ why: 'titles', kept: true });
    expect(data['counts']).toMatchObject({ lookalikes: 1, others: 1, nearMisses: 1 });
  });

  test('caps each list and says how many more there are', async () => {
    engine.stored = snapshot({
      channels: Array.from({ length: 5 }, (_, n) =>
        channel({ id: `UC${String(n).repeat(22)}`, title: `Peer ${n}` }),
      ),
    });

    const data = jsonOf(await tools.getMap({ channel: '@mychannel', limit: 2 }));

    expect(data['lookalikes']).toHaveLength(2);
    expect(data['moreLookalikes']).toBe(3);
  });

  test('says in a plain sentence that no map exists yet', async () => {
    engine.stored = null;

    const result = await tools.getMap({ channel: '@nobody' });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(
      'No map has been made for this channel yet. Use make_map to make one; it takes several minutes.',
    );
  });

  test('refuses something that is not a channel without asking the store', async () => {
    const result = await tools.getMap({ channel: 'https://evil.example/@x' });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/^Not a valid YouTube channel handle, id or URL/);
    expect(engine.lookups).toEqual([]);
  });

  test('turns an unexpected failure into one clean sentence and logs it', async () => {
    engine.findSnapshot = () => {
      throw new Error('SQLITE_CANTOPEN: unable to open /home/someone/secret/jgtube.db\n  at x');
    };

    const result = await tools.getMap({ channel: '@mychannel' });

    expect(result.isError).toBe(true);
    expect(textOf(result)).not.toContain('/home/someone');
    expect(textOf(result)).not.toContain('\n');
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain('get_map');
  });
});

describe('get_breakouts', () => {
  test('lists look-alike breakouts with the evidence behind each score', async () => {
    const data = jsonOf(await tools.getBreakouts({ channel: '@mychannel' }));

    expect(data).toEqual({
      center: { id: CENTER_ID, title: 'My Channel' },
      shown: 2,
      breakouts: [
        {
          video: 'aaaaaaaaaa1',
          title: 'America Just Built The Impossible',
          channel: 'Alpha',
          channelId: ALPHA_ID,
          subs: 5000,
          views: 90_000,
          usual: 10_889,
          score: 8.3,
          sample: 14,
          hits: '3/15',
          channelAgeDays: 72,
          ageDays: 6,
          published: '6d ago',
          secs: 912,
        },
        {
          video: 'bbbbbbbbbb1',
          title: 'Why This Bridge Changed Everything',
          channel: 'Beta',
          channelId: BETA_ID,
          views: 4000,
          usual: 1315,
          score: 3,
          sample: 3,
          hits: '1/4',
          ageDays: 6,
          published: '6d ago',
          caution: 'few-videos',
        },
      ],
    });
  });

  test('includes other channels, strongest first, when look-alikes only is off', async () => {
    const data = jsonOf(
      await tools.getBreakouts({ channel: '@mychannel', lookalikes_only: false }),
    );
    const rows = data['breakouts'] as Array<Record<string, unknown>>;

    expect(rows.map((row) => row['video'])).toEqual(['ggggggggggg', 'aaaaaaaaaa1', 'bbbbbbbbbb1']);
    expect(rows[0]?.['lookalike']).toBe(false);
    expect(rows[1]).not.toHaveProperty('lookalike');
  });

  test('caps the list and says how many more there are', async () => {
    const data = jsonOf(await tools.getBreakouts({ channel: '@mychannel', limit: 1 }));

    expect(data['shown']).toBe(1);
    expect(data['more']).toBe(1);
  });

  test('says when no map exists', async () => {
    engine.stored = null;

    expect((await tools.getBreakouts({ channel: '@nobody' })).isError).toBe(true);
  });
});

describe('get_thumbnail_board', () => {
  test('lists winners beside ordinary videos per channel, and the owner’s own videos', async () => {
    const data = jsonOf(await tools.getThumbnailBoard({ channel: '@mychannel' }));

    expect(data).toEqual({
      winnerMinScore: 2,
      ordinaryMaxScore: 1.2,
      own: {
        id: CENTER_ID,
        title: 'My Channel',
        subs: 1200,
        videos: [
          { video: 'ccccccccc01', title: 'Title of ccccccccc01', views: 800, score: 1.1 },
          { video: 'ccccccccc02', title: 'Title of ccccccccc02', views: 300 },
        ],
      },
      channels: [
        {
          id: ALPHA_ID,
          title: 'Alpha',
          subs: 5000,
          winnerCount: 5,
          scoredCount: 20,
          winners: [
            { video: 'aaaaaaaaaa1', title: 'Title of aaaaaaaaaa1', views: 90_000, score: 8.3 },
            { video: 'aaaaaaaaaa2', title: 'Title of aaaaaaaaaa2', views: 50_000, score: 4.5 },
            { video: 'aaaaaaaaaa3', title: 'Title of aaaaaaaaaa3', views: 30_000, score: 2.7 },
          ],
          ordinary: [
            { video: 'aaaaaaaaaa8', title: 'Title of aaaaaaaaaa8', views: 9000, score: 0.8 },
            { video: 'aaaaaaaaaa9', title: 'Title of aaaaaaaaaa9', views: 7000, score: 0.6 },
          ],
        },
        {
          id: GIANT_ID,
          title: 'Gamma',
          subs: 800,
          winnerCount: 1,
          scoredCount: 9,
          winners: [
            { video: 'ggggggggg01', title: 'Title of ggggggggg01', views: 20_000, score: 3.3 },
          ],
          ordinary: [],
        },
      ],
      channelsWithoutWinners: 1,
    });
  });

  test('caps channels and videos per channel', async () => {
    const data = jsonOf(
      await tools.getThumbnailBoard({ channel: '@mychannel', channels: 1, per_channel: 1 }),
    );
    const channels = data['channels'] as Array<Record<string, unknown[]>>;

    expect(channels).toHaveLength(1);
    expect(channels[0]?.['winners']).toHaveLength(1);
    expect(channels[0]?.['ordinary']).toHaveLength(1);
    expect(data['moreChannels']).toBe(1);
  });

  test('says when no map exists', async () => {
    engine.storedBoard = null;

    const result = await tools.getThumbnailBoard({ channel: '@nobody' });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/^No map has been made/);
  });

  test('an empty board is still an answer', async () => {
    engine.storedBoard = board({ channels: [] });

    const data = jsonOf(await tools.getThumbnailBoard({ channel: '@mychannel' }));

    expect(data['channels']).toEqual([]);
    expect(data).not.toHaveProperty('channelsWithoutWinners');
  });
});

describe('get_channel_videos', () => {
  test('lists one stored channel’s videos with their scores', async () => {
    const data = jsonOf(await tools.getChannelVideos({ channel: '@alpha' }));

    expect(data).toEqual({
      channel: { id: ALPHA_ID, title: 'Alpha', handle: 'alpha', subs: 5000 },
      stored: 3,
      shown: 3,
      videos: [
        {
          video: 'aaaaaaaaa00',
          title: 'Video 0',
          views: 10_000,
          score: 5.6,
          usual: 1801,
          sample: 12,
          ageDays: 0,
          published: '0w ago',
        },
        {
          video: 'aaaaaaaaa01',
          title: 'Video 1',
          views: 9000,
          score: 4.6,
          usual: 1801,
          sample: 12,
          ageDays: 7,
          published: '1w ago',
          secs: 600,
        },
        {
          video: 'aaaaaaaaa02',
          title: 'Video 2',
          views: 8000,
          ageDays: 14,
          published: '2w ago',
          secs: 600,
        },
      ],
    });
  });

  test('can list the newest first', async () => {
    engine.storedVideos = {
      ...channelVideos(),
      videos: [...channelVideos().videos].reverse(),
    };

    const data = jsonOf(await tools.getChannelVideos({ channel: '@alpha', order: 'newest' }));
    const rows = data['videos'] as Array<Record<string, unknown>>;

    expect(rows.map((row) => row['ageDays'])).toEqual([0, 7, 14]);
  });

  test('caps the list and says how many more there are', async () => {
    engine.storedVideos = channelVideos(30);

    const data = jsonOf(await tools.getChannelVideos({ channel: '@alpha', limit: 5 }));

    expect(data['shown']).toBe(5);
    expect(data['more']).toBe(25);
    expect(data['stored']).toBe(30);
  });

  test('says when the channel is not stored', async () => {
    engine.storedVideos = null;

    const result = await tools.getChannelVideos({ channel: '@stranger' });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/^This channel is not in the store yet/);
  });
});
