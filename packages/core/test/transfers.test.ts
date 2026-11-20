import { describe, expect, test } from 'vitest';
import type { Place } from '../src/transfer/places';
import {
  TRANSFER_MAX_FORMATS,
  TRANSFER_MAX_IDEAS,
  TRANSFER_VARIANTS_SHOWN,
  TRANSFER_VERSIONS_SHOWN,
  TRANSFER_WINDOW_DAYS,
  buildTransferList,
  type TransferInput,
} from '../src/transfer/transfers';
import type { OwnerPlace, RecentVideo } from '../src/transfer/types';

const NOW = new Date('2026-11-20T12:00:00Z');
const DAY_MS = 86_400_000;
const AMERICA: OwnerPlace = { key: 'US', name: 'America', source: 'titles' };

interface ChannelSpec {
  readonly subscribers?: number | null;
  readonly country?: string | null;
}

/** Channels by one letter; tests say only what matters about each. */
const CHANNELS: Readonly<Record<string, ChannelSpec>> = {
  R: { subscribers: 7440, country: 'US' },
  O: { subscribers: 23_500, country: 'BA' },
  V: { subscribers: 35 },
  S: { subscribers: 94_800 },
  K: { subscribers: 4000, country: 'KR' },
  J: { subscribers: 6000, country: 'JP' },
  U: { subscribers: 3000, country: 'US' },
  N: { subscribers: 2000 },
};

let counter = 0;
const video = (channel: string, title: string, views: number, daysAgo = 10): RecentVideo => {
  counter += 1;
  const spec = CHANNELS[channel] ?? {};
  return {
    id: `v${String(counter).padStart(10, '0')}`,
    channelId: `UC${channel.repeat(22)}`,
    title,
    views,
    durationSeconds: 600,
    publishedAt: new Date(NOW.getTime() - daysAgo * DAY_MS),
    channelTitle: `Channel ${channel}`,
    subscribers: spec.subscribers === undefined ? 5000 : spec.subscribers,
    country: spec.country ?? null,
  };
};

const build = (videos: readonly RecentVideo[], overrides: Partial<TransferInput> = {}) =>
  buildTransferList(
    { videos, ownerPlace: AMERICA, scoresOf: () => new Map(), savedIdeas: [], ...overrides },
    NOW,
  );

const FUEL = [
  video('R', 'South Africa Just Found A Fuel That Shouldn’t Exist', 521_000, 21),
  video('O', "Australia Just Found A Fuel That Shouldn't Exist", 385_000, 28),
  video('N', 'UK Just Found A Fuel That Shouldn’t Exist', 596, 28),
];

describe('buildTransferList: one idea made for several countries', () => {
  test('says how far back it looked and how much it went through', () => {
    expect(build(FUEL)).toMatchObject({
      ownerPlace: AMERICA,
      windowDays: TRANSFER_WINDOW_DAYS,
      videosChecked: 3,
      ideaCount: 1,
      opportunityCount: 1,
    });
    expect(TRANSFER_WINDOW_DAYS).toBe(90);
  });

  test('describes the idea: its template, its versions most viewed first, the spread and the places', () => {
    const [idea] = build(FUEL).ideas;

    expect(idea).toMatchObject({
      key: '{place} just found fuel shouldn exist',
      template: "{place} just found a fuel that shouldn't exist",
      versionCount: 3,
      channelCount: 3,
      saved: false,
      places: [
        { key: 'ZA', name: 'South Africa', versions: 1, bestViews: 521_000 },
        { key: 'AU', name: 'Australia', versions: 1, bestViews: 385_000 },
        { key: 'GB', name: 'UK', versions: 1, bestViews: 596 },
      ],
    });
    expect(idea?.versions.map((entry) => entry.views)).toEqual([521_000, 385_000, 596]);
    expect(idea?.versions[0]).toEqual({
      videoId: FUEL[0]?.id,
      title: 'South Africa Just Found A Fuel That Shouldn’t Exist',
      channelId: `UC${'R'.repeat(22)}`,
      channelTitle: 'Channel R',
      subscribers: 7440,
      // The title says South Africa; the channel's own country (US) is only a fallback.
      place: { key: 'ZA', name: 'South Africa', source: 'title' },
      views: 521_000,
      score: null,
      ageDays: 21,
      durationSeconds: 600,
      strong: true,
    });
    expect([idea?.best?.views, idea?.worst?.views]).toEqual([521_000, 596]);
  });

  test('is an opportunity when it took off elsewhere and was not made for the owner’s place', () => {
    const [idea] = build(FUEL).ideas;

    expect(idea).toMatchObject({ opportunity: true, verdict: { status: 'open', own: null } });
    expect(idea?.verdict.winner?.place?.name).toBe('South Africa');
  });

  test('is an opportunity when the owner’s place has only a weak version, and gives both numbers', () => {
    const [idea] = build([
      ...FUEL,
      video('V', 'America Just Found A Fuel That Shouldn’t Exist', 2600),
    ]).ideas;

    expect(idea).toMatchObject({
      opportunity: true,
      verdict: { status: 'weak', own: { views: 2600 }, winner: { views: 521_000 } },
    });
  });

  test('is not an opportunity once the owner’s place has won', () => {
    const list = build([
      ...FUEL,
      video('V', 'America Just Found A Fuel That Shouldn’t Exist', 40_000),
    ]);

    expect(list.ideas[0]).toMatchObject({ opportunity: false, verdict: { status: 'done' } });
    expect(list).toMatchObject({ ideaCount: 1, opportunityCount: 0 });
  });

  test('is not an opportunity when nothing took off', () => {
    const [idea] = build([
      video('S', 'Kenya Opens A Giant Solar Farm', 449_000),
      video('N', 'Chile Opens A Giant Solar Farm', 4000),
    ]).ideas;

    // 449,000 views is an ordinary video for a channel with 94,800 subscribers.
    expect(idea).toMatchObject({ opportunity: false, verdict: { status: 'unproven' } });
  });

  test('uses the channel’s outlier score to tell what took off', () => {
    const videos = [
      video('S', 'Kenya Opens A Giant Solar Farm', 449_000),
      video('N', 'Chile Opens A Giant Solar Farm', 4000),
    ];
    const asked: string[] = [];

    const [idea] = build(videos, {
      scoresOf: (channelId) => {
        asked.push(channelId);
        return new Map([[videos[0]?.id ?? '', 7.5]]);
      },
    }).ideas;

    expect(idea?.versions[0]).toMatchObject({ score: 7.5, strong: true });
    expect(idea?.verdict.status).toBe('open');
    expect(asked.sort()).toEqual([`UC${'N'.repeat(22)}`, `UC${'S'.repeat(22)}`]);
  });

  test('lists one-word-different titles made for the owner’s place beside an open idea', () => {
    const [idea] = build([
      ...FUEL,
      video('V', 'America Just Detected A Fuel That Shouldn’t Exist', 2600),
      video('N', 'Peru Just Detected A Fuel That Shouldn’t Exist', 9000),
    ]).ideas.filter((entry) => entry.key === '{place} just found fuel shouldn exist');

    // It cannot tell that "detected" means "found", so the idea stays open and the near copy is shown.
    expect(idea?.verdict.status).toBe('open');
    expect(idea?.variants).toEqual([
      {
        videoId: expect.any(String),
        title: 'America Just Detected A Fuel That Shouldn’t Exist',
        channelTitle: 'Channel V',
        views: 2600,
        word: 'detected',
      },
    ]);
  });

  test('shows only a few such titles', () => {
    const subjects = ['Engine', 'Metal', 'Crystal', 'Battery', 'Reactor'];
    const [idea] = build([
      ...FUEL,
      ...subjects.map((subject, index) =>
        video('V', `America Just Found A ${subject} That Shouldn’t Exist`, 100 + index),
      ),
    ]).ideas;

    expect(idea?.variants).toHaveLength(TRANSFER_VARIANTS_SHOWN);
    expect(idea?.variants[0]?.word).toBe('reactor');
  });

  test('leaves out an idea only one channel made', () => {
    expect(
      build([
        video('R', 'Kenya Opens A Giant Solar Farm', 90_000),
        video('R', 'Chile Opens A Giant Solar Farm', 90_000),
      ]).ideas,
    ).toEqual([]);
  });

  test('puts opportunities first, the biggest winner leading, then the rest by their best result', () => {
    const list = build([
      ...FUEL,
      video('R', 'Kenya Opens A Giant Solar Farm', 900_000),
      video('N', 'Chile Opens A Giant Solar Farm', 4000),
      video('S', 'America Builds The Longest Bridge Ever', 9_000_000),
      video('N', 'Peru Builds The Longest Bridge Ever', 700),
    ]);

    expect(list.ideas.map((idea) => [idea.verdict.status, idea.best?.views])).toEqual([
      ['open', 900_000],
      ['open', 521_000],
      // America's own version took off, so there is nothing left to carry over.
      ['done', 9_000_000],
    ]);
  });

  test('puts an idea already made for two places ahead of a copy made for one place twice', () => {
    const list = build([
      // A plain copy: both channels made it for Kenya, so nothing shows it travels.
      video('R', 'Kenya Is About To Lose Its Entire Northern Coast', 5_000_000),
      video('N', 'Kenya Is About To Lose Its Entire Northern Coast', 900),
      ...FUEL,
    ]);

    expect(list.ideas.map((idea) => [idea.places.length, idea.verdict.winner?.views])).toEqual([
      [3, 521_000],
      [1, 5_000_000],
    ]);
    expect(list.ideas.map((idea) => idea.opportunity)).toEqual([true, true]);
  });

  test('shows only the first versions of an idea made very many times', () => {
    const many = Array.from({ length: TRANSFER_VERSIONS_SHOWN + 5 }, (_, index) =>
      video(index % 2 === 0 ? 'R' : 'N', 'Kenya Opens A Giant Solar Farm', 1000 + index),
    );

    const [idea] = build(many).ideas;

    expect(idea?.versions).toHaveLength(TRANSFER_VERSIONS_SHOWN);
    expect(idea?.versionCount).toBe(TRANSFER_VERSIONS_SHOWN + 5);
    expect(idea?.worst?.views).toBe(1000);
  });

  test('does not change the videos it is given', () => {
    const before = JSON.stringify(FUEL);

    build(FUEL);

    expect(JSON.stringify(FUEL)).toBe(before);
  });
});

describe('buildTransferList: the owner’s place', () => {
  test('judges against whichever place it is given', () => {
    const southAfrica: OwnerPlace = { key: 'ZA', name: 'South Africa', source: 'given' };

    expect(build(FUEL, { ownerPlace: southAfrica }).ideas[0]?.verdict.status).toBe('done');
  });

  test('calls nothing an opportunity when the owner’s place is not known', () => {
    const list = build(FUEL, { ownerPlace: null });

    expect(list.ownerPlace).toBeNull();
    expect(list.ideas[0]).toMatchObject({ opportunity: false, verdict: { status: 'unplaced' } });
    expect(list.opportunityCount).toBe(0);
  });
});

describe('buildTransferList: a niche whose titles name no place', () => {
  const RAMEN = 'I Ate Only Convenience Store Ramen For A Week';

  test('reads each version’s place from its channel’s country', () => {
    const [idea] = build([video('K', RAMEN, 800_000), video('J', RAMEN, 60_000)]).ideas;

    expect(idea?.template).toBe('i ate only convenience store ramen for a week');
    expect(idea?.versions.map((entry) => entry.place)).toEqual([
      { key: 'KR', name: 'South Korea', source: 'channel' },
      { key: 'JP', name: 'Japan', source: 'channel' },
    ]);
    expect(idea).toMatchObject({ opportunity: true, verdict: { status: 'open' } });
  });

  test('applies the same rule: weak, done and unproven', () => {
    const statusWith = (own: RecentVideo) =>
      build([video('K', RAMEN, 800_000), own]).ideas[0]?.verdict.status;

    expect(statusWith(video('U', RAMEN, 900))).toBe('weak');
    expect(statusWith(video('U', RAMEN, 300_000))).toBe('done');
    expect(build([video('S', RAMEN, 5000), video('J', RAMEN, 900)]).ideas[0]?.verdict.status).toBe(
      'unproven',
    );
  });

  test('does not guess when a channel’s country is not known', () => {
    const [idea] = build([video('K', RAMEN, 800_000), video('N', RAMEN, 900)]).ideas;

    // Channel N may be an American channel, so the idea cannot be called untried there.
    expect(idea).toMatchObject({ opportunity: false, verdict: { status: 'unplaced' } });
    expect(idea?.versions[1]?.place).toBeNull();
  });

  test('finds the formats that move between subjects, places or not', () => {
    const list = build([
      video('K', 'I Beat Elden Ring Without Taking Damage', 900_000),
      video('J', 'I Beat Hollow Knight Without Taking Damage', 40_000),
      video('U', 'I Beat Minecraft Without Taking Damage', 7000),
    ]);

    expect(list.formatCount).toBe(1);
    expect(list.formats[0]).toMatchObject({
      template: 'i beat {subject} without taking damage',
      subjectCount: 3,
      channelCount: 3,
    });
    expect(list.ideas).toEqual([]);
  });
});

describe('buildTransferList: saved ideas', () => {
  const KEY = '{place} just found fuel shouldn exist';
  const savedAt = NOW;

  test('marks an idea the owner saved', () => {
    const list = build(FUEL, { savedIdeas: [{ key: KEY, template: 'x', savedAt }] });

    expect(list.ideas.map((idea) => idea.saved)).toEqual([true]);
  });

  test('keeps a saved idea listed after its videos are too old to be read', () => {
    const template = '{place} opens a giant solar farm';
    const list = build(FUEL, {
      savedIdeas: [{ key: '{place} opens giant solar farm', template, savedAt }],
    });

    expect(list.ideas.at(-1)).toEqual({
      key: '{place} opens giant solar farm',
      template,
      verdict: { status: 'gone', winner: null, own: null },
      opportunity: false,
      versions: [],
      versionCount: 0,
      channelCount: 0,
      best: null,
      worst: null,
      places: [],
      variants: [],
      saved: true,
    });
    expect(list.ideaCount).toBe(1);
  });

  test('keeps a saved idea listed when only one channel still has it', () => {
    const list = build([FUEL[0] as RecentVideo], {
      savedIdeas: [{ key: KEY, template: 'x', savedAt }],
    });

    expect(list.ideas).toHaveLength(1);
    expect(list.ideas[0]).toMatchObject({ saved: true, versionCount: 1 });
  });
});

describe('buildTransferList: limits', () => {
  const place = (index: number): Place['name'] =>
    ['Kenya', 'Chile', 'Peru', 'Japan'][index % 4] ?? 'Kenya';

  test('shows only so many ideas and formats, and still counts them all', () => {
    const ideas = Array.from({ length: TRANSFER_MAX_IDEAS + 3 }, (_, index) => [
      video('R', `${place(index)} Builds Machine Number${index}x Today`, 50_000 + index),
      video('N', `${place(index + 1)} Builds Machine Number${index}x Today`, 100),
    ]).flat();

    const list = build(ideas);

    expect(list.ideaCount).toBe(TRANSFER_MAX_IDEAS + 3);
    expect(list.ideas).toHaveLength(TRANSFER_MAX_IDEAS);
    expect(list.formats.length).toBeLessThanOrEqual(TRANSFER_MAX_FORMATS);
  });
});
