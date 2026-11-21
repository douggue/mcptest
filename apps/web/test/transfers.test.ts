import type {
  FormatSubject,
  TransferFormat,
  TransferIdea,
  TransferList,
  TransferVersion,
} from '@jgtube/core';
import { describe, expect, test } from 'vitest';
import { createApi } from '../src/lib/api';
import {
  TRANSFER_FILTERS,
  filterLabel,
  describeFormat,
  describeIdeaReach,
  describeTransfers,
  describeVerdict,
  emptyTransfers,
  formatsFor,
  ideasFor,
  statusLabel,
  templateParts,
  tileOf,
  withSaved,
} from '../src/lib/transfers';

const version = (overrides: Partial<TransferVersion> = {}): TransferVersion => ({
  videoId: 'sssssssssss',
  title: 'South Africa Just Found A Fuel That Shouldn’t Exist',
  channelId: `UC${'a'.repeat(22)}`,
  channelTitle: 'Ronnie',
  subscribers: 7440,
  place: { key: 'ZA', name: 'South Africa', source: 'title' },
  views: 521_000,
  score: 22.8,
  ageDays: 21,
  durationSeconds: 840,
  strong: true,
  channelCountry: null,
  elsewhere: false,
  ...overrides,
});

const own = version({
  videoId: 'aaaaaaaaaaa',
  title: 'America Just Found A Fuel That Shouldn’t Exist',
  channelTitle: 'Valtrum',
  subscribers: 35,
  place: { key: 'US', name: 'America', source: 'title' },
  views: 2600,
  score: null,
  strong: false,
});

const idea = (overrides: Partial<TransferIdea> = {}): TransferIdea => ({
  key: '{place} just found fuel shouldn exist',
  template: "{place} just found a fuel that shouldn't exist",
  verdict: { status: 'open', winner: version(), own: null },
  opportunity: true,
  versions: [version()],
  versionCount: 5,
  channelCount: 4,
  best: version(),
  worst: version({ views: 596 }),
  places: [
    { key: 'ZA', name: 'South Africa', versions: 2, bestViews: 521_000 },
    { key: 'AU', name: 'Australia', versions: 1, bestViews: 385_000 },
  ],
  variants: [],
  saved: false,
  ...overrides,
});

const format = (overrides: Partial<TransferFormat> = {}): TransferFormat => ({
  key: '{place} new invention could make {subject} obsolete forever',
  template: '{place} new invention could make {subject} obsolete forever',
  subjectCount: 4,
  channelCount: 3,
  videoCount: 5,
  bestViews: 129_000,
  medianViews: 34_700,
  places: [],
  subjects: [],
  ...overrides,
});

const listOf = (overrides: Partial<TransferList> = {}): TransferList => ({
  ownerPlace: { key: 'US', name: 'America', source: 'titles' },
  placeCheck: {
    channelId: null,
    chosen: null,
    fromTitles: null,
    fromCountry: null,
    countryCode: null,
    countryAsked: false,
    disagree: false,
  },
  countriesMissing: 0,
  windowDays: 90,
  videosChecked: 15_092,
  ideas: [idea()],
  ideaCount: 137,
  opportunityCount: 37,
  formats: [format()],
  formatCount: 30,
  ...overrides,
});

describe('the filter', () => {
  const ideas = [
    idea(),
    idea({ key: 'done', opportunity: false, saved: true }),
    idea({ key: 'weak', saved: true }),
  ];

  test('offers the opportunities, the formats and the saved ideas', () => {
    expect(TRANSFER_FILTERS.map((option) => [option.id, option.label])).toEqual([
      ['opportunities', 'Opportunities'],
      ['formats', 'Formats'],
      ['saved', 'Kept'],
    ]);
  });

  test('keeps the opportunities not yet saved, or the saved ideas whatever their verdict', () => {
    const list = listOf({ ideas });

    expect(ideasFor(list, 'opportunities').map((entry) => entry.key)).toEqual([
      '{place} just found fuel shouldn exist',
    ]);
    expect(ideasFor(list, 'saved').map((entry) => entry.key)).toEqual(['done', 'weak']);
    expect(ideasFor(list, 'formats')).toEqual([]);
  });

  test('brings an idea back to the opportunities once it is no longer saved', () => {
    const list = withSaved(listOf({ ideas }), 'weak', false);

    expect(ideasFor(list, 'opportunities').map((entry) => entry.key)).toEqual([
      '{place} just found fuel shouldn exist',
      'weak',
    ]);
    expect(ideasFor(list, 'saved').map((entry) => entry.key)).toEqual(['done']);
  });
});

describe('formatsFor', () => {
  const subject = (name: string, ideaKeys: readonly string[], videos = 2): FormatSubject => ({
    subject: name,
    videos,
    channels: 2,
    bestViews: 50_000,
    videoId: 'vvvvvvvvvvv',
    title: `Could make ${name} obsolete`,
    channelTitle: 'Ronnie',
    ideaKeys,
  });
  const subjects = [subject('solar panels', ['weak']), subject('subwoofers', ['other'], 3)];
  const ideas = [idea({ key: 'weak', saved: true }), idea({ key: 'other' })];

  test('leaves a saved idea’s subject out of its format and counts what is left', () => {
    const list = listOf({ ideas, formats: [format({ subjects })] });

    const [shown] = formatsFor(list);

    expect(shown?.subjects.map((entry) => entry.subject)).toEqual(['subwoofers']);
    expect(shown?.subjectCount).toBe(3);
    expect(shown?.videoCount).toBe(3);
  });

  test('drops a format once every subject it lists is saved, and keeps the rest as given', () => {
    const untouched = format({ key: 'other format', subjects: [subject('engines', ['x'])] });
    const list = listOf({
      ideas,
      formats: [format({ subjects: [subject('solar panels', ['weak'])] }), untouched],
    });

    expect(formatsFor(list)).toEqual([untouched]);
  });

  test('keeps a subject while one of the ideas behind it is not saved', () => {
    const list = listOf({
      ideas,
      formats: [format({ subjects: [subject('solar panels', ['weak', 'other'])] })],
    });

    expect(formatsFor(list)[0]?.subjects).toHaveLength(1);
  });
});

describe('withSaved', () => {
  test('marks one idea without touching the list it was given', () => {
    const before = listOf();

    const after = withSaved(before, '{place} just found fuel shouldn exist', true);

    expect(after.ideas.map((entry) => entry.saved)).toEqual([true]);
    expect(before.ideas.map((entry) => entry.saved)).toEqual([false]);
    expect(withSaved(before, 'unknown', true)).toEqual(before);
  });
});

describe('describeVerdict', () => {
  const america = listOf().ownerPlace;

  test('says an idea has not been made for the owner’s place, with the winner’s number', () => {
    expect(describeVerdict(idea(), america)).toBe(
      'Not done for America yet. South Africa’s got 521K views.',
    );
  });

  test('gives both numbers when the owner’s place has a weak version', () => {
    const weak = idea({ verdict: { status: 'weak', winner: version(), own } });

    expect(describeVerdict(weak, america)).toBe(
      'The America version got 2.6K views; South Africa’s got 521K.',
    );
  });

  test('writes the possessive of a name that ends in s without a second s', () => {
    const winner = version({ place: { key: 'BS', name: 'Bahamas', source: 'title' } });

    expect(describeVerdict(idea({ verdict: { status: 'open', winner, own: null } }), america)).toBe(
      'Not done for America yet. Bahamas’ got 521K views.',
    );
  });

  test('speaks of channels, not titles, when the places come from the channels’ countries', () => {
    const winner = version({ place: { key: 'KR', name: 'South Korea', source: 'channel' } });
    const ownChannel = {
      ...own,
      place: { key: 'US', name: 'America', source: 'channel' as const },
    };

    expect(describeVerdict(idea({ verdict: { status: 'open', winner, own: null } }), america)).toBe(
      'No channel from America has made it yet. One from South Korea got 521K views.',
    );
    expect(
      describeVerdict(idea({ verdict: { status: 'weak', winner, own: ownChannel } }), america),
    ).toBe('A channel from America got 2.6K views with it; one from South Korea got 521K.');
  });

  test('says when the owner’s place already won, when nothing took off, and when it cannot tell', () => {
    const verdict = (status: TransferIdea['verdict']['status'], ownVersion = own) =>
      describeVerdict(
        idea({ opportunity: false, verdict: { status, winner: null, own: ownVersion } }),
        america,
      );

    expect(verdict('done')).toBe('Already done for America: its version got 2.6K views.');
    expect(verdict('unproven')).toBe('No version has taken off yet.');
    expect(verdict('unplaced')).toBe(
      'It took off, but the country of one of the channels is not known, so it cannot be called untried for America.',
    );
    expect(verdict('gone')).toBe('None of its videos is from the last three months any more.');
  });

  test('says so when the owner’s own place is not known', () => {
    const unplaced = idea({ verdict: { status: 'unplaced', winner: version(), own: null } });

    expect(describeVerdict(unplaced, null)).toBe(
      'Jgtube cannot tell which country your channel is for, so it cannot say whether this is open to you.',
    );
  });
});

describe('labels and counts', () => {
  test('names each verdict in a word or two', () => {
    expect(
      (['open', 'weak', 'done', 'unproven', 'unplaced', 'gone'] as const).map(statusLabel),
    ).toEqual([
      'Untried',
      'Weak version',
      'Already done',
      'Unproven',
      'Cannot tell',
      'No longer recent',
    ]);
  });

  test('says how far an idea has travelled', () => {
    expect(describeIdeaReach(idea())).toBe('5 versions from 4 channels · made for 2 places');
    expect(
      describeIdeaReach(idea({ versionCount: 2, channelCount: 2, places: [idea().places[0]!] })),
    ).toBe('2 versions from 2 channels · made for 1 place');
    expect(describeIdeaReach(idea({ places: [] }))).toBe('5 versions from 4 channels');
  });

  test('says how widely a format is used', () => {
    expect(describeFormat(format())).toBe('4 subjects · 3 channels · 5 videos');
  });
});

describe('describeTransfers', () => {
  test('says how many opportunities there are, for which place, and how the place was worked out', () => {
    expect(describeTransfers(listOf())).toBe(
      '37 ideas took off for another country and are untried or weak for America, out of 137 that two or more channels on this map made in the last 90 days. Jgtube took America from your channel’s titles.',
    );
  });

  test('counts one as one, and names a place the owner or the channel’s country gave', () => {
    const one = listOf({
      opportunityCount: 1,
      ownerPlace: { key: 'CA', name: 'Canada', source: 'country' },
    });
    const given = listOf({ ownerPlace: { key: 'CA', name: 'Canada', source: 'given' } });

    expect(describeTransfers(one)).toContain('1 idea took off for another country and is untried');
    expect(describeTransfers(one)).toContain('Jgtube took Canada from your channel’s country.');
    expect(describeTransfers(given)).not.toContain('Jgtube took');
  });

  test('leaves the saved ideas out of the count and says where they are', () => {
    const saved = listOf({
      ideas: [
        idea(),
        idea({ key: 'kept', saved: true }),
        idea({ key: 'done', opportunity: false, saved: true }),
      ],
    });

    expect(describeTransfers(saved)).toBe(
      '36 ideas took off for another country and are untried or weak for America, out of 137 that two or more channels on this map made in the last 90 days. The 2 you saved are under Saved. Jgtube took America from your channel’s titles.',
    );
  });

  test('says when the owner’s place is not known', () => {
    expect(describeTransfers(listOf({ ownerPlace: null, opportunityCount: 0 }))).toBe(
      'Jgtube cannot tell which country your channel is for, so it cannot say which of the 137 ideas that two or more channels on this map made in the last 90 days are open to you.',
    );
  });

  test('says when nothing was found', () => {
    expect(describeTransfers(listOf({ ideaCount: 0, opportunityCount: 0, ideas: [] }))).toBe(
      'No idea has been made by two or more of the channels on this map in the last 90 days.',
    );
  });
});

describe('emptyTransfers', () => {
  test('explains an empty view in the owner’s terms', () => {
    const none = listOf({ ideas: [], formats: [], opportunityCount: 0, formatCount: 0 });

    expect(emptyTransfers(none, 'opportunities')).toBe(
      'None of the 137 ideas is open for America right now: each was already done there or has not taken off anywhere.',
    );
    expect(emptyTransfers(none, 'formats')).toBe(
      'No title format is used for three or more subjects by two or more channels yet.',
    );
    expect(emptyTransfers(none, 'saved')).toBe(
      'You have not saved an idea yet. Press Save on one to keep it here.',
    );
    expect(emptyTransfers({ ...none, ownerPlace: null }, 'opportunities')).toBe(
      'Nothing can be called open until Jgtube knows which country your channel is for.',
    );
    expect(
      emptyTransfers(
        { ...none, opportunityCount: 1, ideas: [idea({ saved: true })] },
        'opportunities',
      ),
    ).toBe(
      'Every idea open for America is one you saved. They are under Saved; stop saving one to bring it back here.',
    );
  });
});

describe('templateParts', () => {
  test('splits a template into its words and its slots, each slot named', () => {
    expect(templateParts("{place} just found {n} fuels that shouldn't exist")).toEqual([
      { slot: 'Country' },
      { text: ' just found ' },
      { slot: 'Number' },
      { text: " fuels that shouldn't exist" },
    ]);
    expect(templateParts('i beat {subject} without taking damage')).toEqual([
      { text: 'i beat ' },
      { slot: 'Subject' },
      { text: ' without taking damage' },
    ]);
  });

  test('gives a template with no slot back as one piece of text', () => {
    expect(templateParts('i ate only ramen')).toEqual([{ text: 'i ate only ramen' }]);
    expect(templateParts('')).toEqual([]);
  });
});

describe('tileOf', () => {
  test('turns a version into what a thumbnail tile shows', () => {
    expect(tileOf(version())).toEqual({
      videoId: 'sssssssssss',
      title: 'South Africa Just Found A Fuel That Shouldn’t Exist',
      views: 521_000,
      score: 22.8,
      publishedRaw: '3 weeks ago',
      ageDays: 21,
      durationSeconds: 840,
    });
  });
});

describe('the transfer calls', () => {
  const reply = (data: unknown, status = 200): Response =>
    new Response(
      JSON.stringify({ success: status < 400, data, error: status < 400 ? null : 'No' }),
      {
        status,
      },
    );

  test('reads the list for the channel on screen, or for none', async () => {
    const asked: string[] = [];
    const api = createApi(async (input) => {
      asked.push(input);
      return reply(listOf());
    });

    expect(await api.transfers('UC0UJp3kmO7wf33XFf56gbTw')).toEqual(listOf());
    await api.transfers(null);

    expect(asked).toEqual(['/api/transfers?channel=UC0UJp3kmO7wf33XFf56gbTw', '/api/transfers']);
  });

  test('saves an idea by its key', async () => {
    const sent: Array<[string, unknown]> = [];
    const api = createApi(async (input, init) => {
      sent.push([input, JSON.parse(String(init?.body))]);
      return reply({ key: 'a b c', saved: true });
    });

    await api.setTransferSaved('a b c', true);

    expect(sent).toEqual([['/api/transfers/save', { key: 'a b c', saved: true }]]);
  });

  test('fails with the server’s reason when an idea cannot be saved', async () => {
    const api = createApi(async () => reply(null, 404));

    await expect(api.setTransferSaved('gone', true)).rejects.toThrow('No');
  });
});

describe('the label of each view of the ideas', () => {
  test('says how many ideas are saved, so a saved idea is seen to have gone somewhere', () => {
    const saved = (key: string, isSaved: boolean) => ({ key, saved: isSaved });

    expect(
      filterLabel('saved', { ideas: [saved('a', true), saved('b', false), saved('c', true)] }),
    ).toBe('Kept · 2');
    expect(filterLabel('saved', { ideas: [saved('a', false)] })).toBe('Kept');
    expect(filterLabel('saved', null)).toBe('Kept');
    expect(filterLabel('opportunities', { ideas: [saved('a', true)] })).toBe('Opportunities');
  });
});
