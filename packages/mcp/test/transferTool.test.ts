import { beforeEach, describe, expect, test } from 'vitest';
import { createToolHandlers, type ToolHandlers } from '../src/tools';
import { FakeEngine, format, idea, jsonOf, textOf, transferList, version } from './fakes';

let engine: FakeEngine;
let tools: ToolHandlers;

beforeEach(() => {
  engine = new FakeEngine();
  tools = createToolHandlers({ engine, log: () => {} });
});

type Entry = Record<string, unknown>;
const listOf = (data: Record<string, unknown>): Entry[] => data['list'] as Entry[];

describe('list_transfer_opportunities', () => {
  test('lists the ideas that are open or weak for the owner’s place, compactly', async () => {
    const data = jsonOf(await tools.listTransferOpportunities({}));

    expect(data).toEqual({
      place: 'America',
      placeFrom: 'titles',
      windowDays: 90,
      videos: 15_092,
      ideas: 1,
      opportunities: 1,
      formats: 1,
      show: 'opportunities',
      shown: 1,
      list: [
        {
          key: '{place} just found fuel shouldn exist',
          title: "{place} just found a fuel that shouldn't exist",
          status: 'open',
          verdict: 'Not done for America yet; the South Africa version got 521000 views.',
          places: ['South Africa', 'UK'],
          channels: 2,
          versions: [
            {
              video: 'sssssssssss',
              place: 'South Africa',
              channel: 'Alpha',
              subs: 7440,
              views: 521_000,
              score: 22.8,
              ageDays: 21,
              tookOff: true,
            },
            { video: 'uuuuuuuuuuu', place: 'UK', channel: 'Beta', views: 596, ageDays: 21 },
          ],
          oneWordOff: [
            {
              video: 'vvvvvvvvvvv',
              title: 'America Just Detected A Fuel That Shouldn’t Exist',
              channel: 'Valtrum',
              views: 2600,
              word: 'detected',
            },
          ],
        },
      ],
    });
    expect(engine.transferReads).toEqual([{}]);
  });

  test('gives each version’s channel country, and marks one made from elsewhere', async () => {
    const abroad = version({ channelCountry: { key: 'US', name: 'America' }, elsewhere: true });
    const home = version({
      videoId: 'hhhhhhhhhhh',
      channelCountry: { key: 'ZA', name: 'South Africa' },
    });
    engine.transfers = transferList({ ideas: [idea({ versions: [abroad, home] })] });

    const [entry] = listOf(jsonOf(await tools.listTransferOpportunities({})));
    const versions = entry?.['versions'] as Record<string, unknown>[];

    expect(versions[0]).toMatchObject({ channelCountry: 'America', madeFromElsewhere: true });
    expect(versions[1]).toMatchObject({ channelCountry: 'South Africa' });
    expect(versions[1]).not.toHaveProperty('madeFromElsewhere');
  });

  test('says in words when the owner’s version was weak', async () => {
    const own = version({
      videoId: 'aaaaaaaaaaa',
      place: { key: 'US', name: 'America', source: 'channel' },
      views: 2600,
      strong: false,
    });
    engine.transfers = transferList({
      ideas: [idea({ verdict: { status: 'weak', winner: version(), own }, variants: [] })],
    });

    const [entry] = listOf(jsonOf(await tools.listTransferOpportunities({})));

    expect(entry?.['verdict']).toBe(
      'The America version got 2600 views; the South Africa version got 521000.',
    );
    expect(entry).not.toHaveProperty('oneWordOff');
  });

  test('passes on the owner’s channel and place', async () => {
    await tools.listTransferOpportunities({ channel: '@mychannel', place: 'south africa' });

    expect(engine.transferReads).toEqual([
      { channel: '@mychannel', place: { key: 'ZA', name: 'South Africa' } },
    ]);
  });

  test('refuses a channel it cannot read and a place it does not know, without reading the store', async () => {
    const badChannel = await tools.listTransferOpportunities({ channel: 'not a channel!' });
    const badPlace = await tools.listTransferOpportunities({ place: 'Atlantis' });

    expect(badChannel.isError).toBe(true);
    expect(textOf(badChannel)).toMatch(/^Not a valid YouTube channel/);
    expect(textOf(badPlace)).toBe(
      'place is a country or region name such as Canada, or a two-letter country code.',
    );
    expect(engine.transferReads).toEqual([]);
  });

  test('shows only opportunities unless asked for everything or for the saved ones', async () => {
    engine.transfers = transferList({
      ideas: [
        idea(),
        idea({
          key: 'done idea',
          opportunity: false,
          verdict: { status: 'done', winner: null, own: version() },
          saved: true,
          variants: [],
        }),
        idea({
          key: 'gone idea',
          template: 'gone idea',
          opportunity: false,
          verdict: { status: 'gone', winner: null, own: null },
          versions: [],
          versionCount: 0,
          channelCount: 0,
          best: null,
          worst: null,
          places: [],
          variants: [],
          saved: true,
        }),
      ],
      ideaCount: 2,
    });
    const keysFor = async (show: 'opportunities' | 'all' | 'saved') =>
      listOf(jsonOf(await tools.listTransferOpportunities({ show }))).map((entry) => entry['key']);

    expect(await keysFor('opportunities')).toEqual(['{place} just found fuel shouldn exist']);
    expect(await keysFor('all')).toHaveLength(3);
    expect(await keysFor('saved')).toEqual(['done idea', 'gone idea']);
    const saved = listOf(jsonOf(await tools.listTransferOpportunities({ show: 'saved' })));
    expect(saved[0]).toMatchObject({ status: 'done', saved: true });
    expect(saved[1]).toEqual({
      key: 'gone idea',
      title: 'gone idea',
      status: 'gone',
      verdict: 'Saved, but none of its videos is from the last 90 days any more.',
      saved: true,
    });
  });

  test('lists the title formats when asked', async () => {
    const data = jsonOf(await tools.listTransferOpportunities({ show: 'formats' }));

    expect(data['show']).toBe('formats');
    expect(data['list']).toEqual([
      {
        title: '{place} new invention could make {subject} obsolete forever',
        subjects: 4,
        channels: 3,
        videos: 5,
        bestViews: 129_000,
        medianViews: 34_701,
        places: ['America'],
        top: [{ subject: 'carbon fiber', views: 129_000, video: 'ccccccccccc', uses: 2 }],
      },
    ]);
  });

  test('caps the list and the versions of each idea', async () => {
    const many = Array.from({ length: 9 }, (_, index) =>
      version({ videoId: `v${String(index).padStart(10, '0')}`, views: 9000 - index }),
    );
    engine.transfers = transferList({
      ideas: [idea({ versions: many, versionCount: 14 }), idea({ key: 'second' })],
      opportunityCount: 2,
      formats: [format(), format({ key: 'another' })],
      formatCount: 2,
    });

    const ideas = jsonOf(await tools.listTransferOpportunities({ limit: 1 }));
    const formats = jsonOf(await tools.listTransferOpportunities({ show: 'formats', limit: 1 }));

    expect(ideas).toMatchObject({ shown: 1, more: 1 });
    expect((listOf(ideas)[0]?.['versions'] as unknown[]).length).toBe(5);
    expect(listOf(ideas)[0]?.['moreVersions']).toBe(9);
    expect(formats).toMatchObject({ shown: 1, more: 1 });
  });

  test('says when the owner’s place is not known', async () => {
    engine.transfers = transferList({
      ownerPlace: null,
      ideas: [
        idea({ opportunity: false, verdict: { status: 'unplaced', winner: null, own: null } }),
      ],
      opportunityCount: 0,
    });

    const data = jsonOf(await tools.listTransferOpportunities({ show: 'all' }));

    expect(data).not.toHaveProperty('place');
    expect(data['placeUnknown']).toBe(
      'The owner’s place could not be told from their channel. Pass place to judge the ideas for it.',
    );
    expect(listOf(data)[0]?.['verdict']).toBe(
      'Cannot be judged: the place of the owner or of a version is not known.',
    );
  });

  test('refuses a limit or a view outside what it offers', async () => {
    const limit = await tools.listTransferOpportunities({ limit: 0 });
    const show = await tools.listTransferOpportunities({ show: 'everything' as 'all' });

    expect(textOf(limit)).toBe('limit is a whole number from 1 to 30.');
    expect(textOf(show)).toBe('show is "opportunities", "formats", "saved" or "all".');
  });
});
