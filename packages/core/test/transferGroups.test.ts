import { describe, expect, test } from 'vitest';
import {
  FORMAT_MAX_SUBJECT_WORDS,
  FORMAT_MIN_CHANNELS,
  FORMAT_MIN_FIXED_WORDS,
  FORMAT_MIN_SUBJECTS,
  groupFormats,
  indexBySubject,
  oneWordVariants,
} from '../src/transfer/formats';
import {
  IDEA_MAX_TAG_WORDS,
  IDEA_MIN_CHANNELS,
  IDEA_MIN_VIDEOS,
  IDEA_MIN_WORDS,
  groupIdeas,
  isShared,
} from '../src/transfer/ideas';
import type { RecentVideo } from '../src/transfer/types';

const NOW = new Date('2026-11-20T12:00:00Z');
let counter = 0;

/** A recent video; the channel is named by one letter. */
const video = (channel: string, title: string, views = 1000): RecentVideo => {
  counter += 1;
  return {
    id: `v${String(counter).padStart(10, '0')}`,
    channelId: `UC${channel.repeat(22)}`,
    title,
    views,
    durationSeconds: 600,
    publishedAt: NOW,
    channelTitle: `Channel ${channel}`,
    subscribers: 5000,
    country: null,
  };
};

const titlesByIdea = (videos: readonly RecentVideo[]) =>
  groupIdeas(videos).map((idea) => idea.videos.map((entry) => entry.video.title));

describe('groupIdeas', () => {
  test('names its limits', () => {
    expect([IDEA_MIN_WORDS, IDEA_MAX_TAG_WORDS, IDEA_MIN_VIDEOS, IDEA_MIN_CHANNELS]).toEqual([
      3, 2, 2, 2,
    ]);
  });

  test('puts country-swapped copies of one title together and another subject apart', () => {
    const ideas = groupIdeas([
      video('A', 'South Africa Just Found A Fuel That Shouldn’t Exist'),
      video('B', "Australia Just Found A Fuel That Shouldn't Exist"),
      video('C', 'UK Just Found An Engine That Shouldn’t Exist'),
    ]);

    expect(ideas.map((idea) => [idea.key, idea.videos.length])).toEqual([
      ['{place} just found engine shouldn exist', 1],
      ['{place} just found fuel shouldn exist', 2],
    ]);
  });

  test('puts copies that differ only in a number together', () => {
    expect(
      titlesByIdea([
        video('A', '25 Cheap Camping Tricks That Beat $500 Gadgets'),
        video('B', '20 Cheap Camping Tricks That Beat $300 Gadgets'),
      ]),
    ).toHaveLength(1);
  });

  test('joins a title to the same title with a short tag added behind or in front', () => {
    const ideas = groupIdeas([
      video('A', 'Israel Just Found A Fuel That Shouldn’t Exist! - must watch'),
      video('B', 'Kenya Just Found A Fuel That Shouldn’t Exist'),
      video('C', 'BREAKING: Japan Just Found A Fuel That Shouldn’t Exist'),
    ]);

    expect(ideas).toHaveLength(1);
    // The idea is known by the title without the tag.
    expect(ideas[0]?.key).toBe('{place} just found fuel shouldn exist');
    expect(ideas[0]?.videos).toHaveLength(3);
  });

  test('does not join a title to one with more added than a tag', () => {
    expect(
      titlesByIdea([
        video('A', 'Kenya Just Found A Fuel That Shouldn’t Exist'),
        video('B', 'Kenya Just Found A Fuel That Shouldn’t Exist And Nobody Knows Why'),
      ]),
    ).toHaveLength(2);
  });

  test('does not join titles that differ by a word in the middle: it cannot tell a synonym from a subject', () => {
    expect(
      titlesByIdea([
        video('A', 'Kenya Just Found A Fuel That Shouldn’t Exist'),
        video('B', 'Chile Just Detected A Fuel That Shouldn’t Exist'),
        video('C', 'Peru Just Found An Engine That Shouldn’t Exist'),
      ]),
    ).toHaveLength(3);
  });

  test('does not treat a phrase of fewer than three words as an idea', () => {
    expect(groupIdeas([video('A', 'Japan News'), video('B', 'Kenya News')])).toEqual([]);
    expect(groupIdeas([video('A', 'Top 10'), video('B', 'Top 5')])).toEqual([]);
  });

  test('does not join a title that names a place to one that does not', () => {
    expect(
      titlesByIdea([
        video('A', 'Japan Builds The Longest Bridge Ever'),
        video('B', 'Builds The Longest Bridge Ever'),
      ]),
    ).toHaveLength(2);
  });

  test('gives the same grouping whatever order the videos come in', () => {
    const videos = [
      video('A', 'Kenya Opens A Giant Solar Farm'),
      video('B', 'Chile Opens A Giant Solar Farm - full story'),
      video('C', 'Peru Opens A Giant Wind Farm'),
    ];
    const keys = (list: readonly RecentVideo[]) => groupIdeas(list).map((idea) => idea.key);

    expect(keys([...videos].reverse())).toEqual(keys(videos));
  });

  test('works the same on titles that name no place at all', () => {
    const ideas = groupIdeas([
      video('A', 'I Ate Only Gas Station Food For A Week'),
      video('B', 'I ATE ONLY GAS STATION FOOD FOR A WEEK!'),
      video('C', 'I Ate Only Airport Food For A Week'),
    ]);

    expect(ideas.map((idea) => idea.videos.length).sort()).toEqual([1, 2]);
  });

  test('counts an idea as shared only when two channels made it', () => {
    const [once, twice] = [
      groupIdeas([
        video('A', 'Kenya Opens A Giant Solar Farm'),
        video('A', 'Chile Opens A Giant Solar Farm'),
      ]),
      groupIdeas([
        video('A', 'Kenya Opens A Giant Solar Farm'),
        video('B', 'Chile Opens A Giant Solar Farm'),
      ]),
    ];

    expect(once.map(isShared)).toEqual([false]);
    expect(twice.map(isShared)).toEqual([true]);
  });
});

describe('groupFormats', () => {
  const invention = (channel: string, place: string, subject: string, views = 1000) =>
    video(channel, `${place}’s New Invention Could Make ${subject} Obsolete Forever`, views);

  const formatsOf = (videos: readonly RecentVideo[]) =>
    groupFormats(indexBySubject(groupIdeas(videos)));

  test('names its limits', () => {
    expect([
      FORMAT_MAX_SUBJECT_WORDS,
      FORMAT_MIN_FIXED_WORDS,
      FORMAT_MIN_SUBJECTS,
      FORMAT_MIN_CHANNELS,
    ]).toEqual([2, 3, 3, 2]);
  });

  test('finds a format used for several subjects, with one or two words for the subject', () => {
    const formats = formatsOf([
      invention('A', 'America', 'Carbon Fiber', 129_000),
      invention('A', 'America', 'Home Subwoofers', 68_000),
      invention('B', 'Kenya', 'TVs', 3800),
      invention('C', 'America', 'Solar Panels', 1400),
    ]);

    expect(formats).toHaveLength(1);
    expect(formats[0]).toMatchObject({
      key: '{place} new invention could make {subject} obsolete forever',
      template: '{place} new invention could make {subject} obsolete forever',
    });
    expect(formats[0]?.subjects.map((entry) => entry.subject)).toEqual([
      'carbon fiber',
      'home subwoofers',
      'tvs',
      'solar panels',
    ]);
  });

  test('names the ideas behind each subject, so a saved idea can be told apart', () => {
    const [format] = formatsOf([
      invention('A', 'America', 'Carbon Fiber', 129_000),
      invention('B', 'Kenya', 'Carbon Fiber', 900),
      invention('B', 'Kenya', 'TVs', 3800),
      invention('C', 'America', 'Solar Panels', 1400),
    ]);

    expect(format?.subjects.map((entry) => entry.ideaKeys)).toEqual([
      ['{place} new invention could make carbon fiber obsolete forever'],
      ['{place} new invention could make tvs obsolete forever'],
      ['{place} new invention could make solar panels obsolete forever'],
    ]);
  });

  test('keeps the title’s own small words in the format as shown', () => {
    const [format] = formatsOf([
      video('A', 'Why Nobody Is Buying A Tesla In Winter Anymore'),
      video('B', 'Why Nobody Is Buying A Pickup In Winter Anymore'),
      video('C', 'Why Nobody Is Buying A Camper Van In Winter Anymore'),
    ]);

    expect(format?.template).toBe('why nobody is buying a {subject} in winter anymore');
  });

  test('needs three subjects', () => {
    expect(
      formatsOf([invention('A', 'America', 'TVs'), invention('B', 'Kenya', 'Radios')]),
    ).toEqual([]);
  });

  test('needs two channels', () => {
    expect(
      formatsOf(['TVs', 'Radios', 'Phones', 'Fans'].map((s) => invention('A', 'America', s))),
    ).toEqual([]);
  });

  test('needs three words around the subject', () => {
    expect(
      formatsOf([
        video('A', 'Best Tacos Ever'),
        video('B', 'Best Ramen Ever'),
        video('C', 'Best Burgers Ever'),
      ]),
    ).toEqual([]);
  });

  test('counts each title in one format: the one with the most subjects', () => {
    const formats = formatsOf([
      invention('A', 'America', 'TVs'),
      invention('B', 'Kenya', 'Radios'),
      invention('C', 'Chile', 'Phones'),
      invention('A', 'Peru', 'Fans'),
      // Shares "could make tvs obsolete forever" with the first, with another word before it.
      video('B', 'Japan’s New Machine Could Make TVs Obsolete Forever'),
      video('C', 'Japan’s New Robot Could Make TVs Obsolete Forever'),
    ]);

    expect(formats.map((format) => [format.key, format.videoCount])).toEqual([
      ['{place} new invention could make {subject} obsolete forever', 4],
    ]);
  });

  test('finds a format in titles that name no place: the subject is what moves', () => {
    const formats = formatsOf([
      video('A', 'I Beat Elden Ring Without Taking Damage', 900_000),
      video('B', 'I Beat Hollow Knight Without Taking Damage', 40_000),
      video('C', 'I Beat Minecraft Without Taking Damage', 7000),
      video('C', 'I Cooked Dinner For My Whole Street'),
    ]);

    expect(formats.map((format) => [format.template, format.subjectCount])).toEqual([
      ['i beat {subject} without taking damage', 3],
    ]);
    expect(formats[0]).toMatchObject({
      channelCount: 3,
      videoCount: 3,
      bestViews: 900_000,
      medianViews: 40_000,
      places: [],
    });
  });

  test('says which places a format was made for, best result first', () => {
    const [format] = formatsOf([
      invention('A', 'America', 'TVs', 5000),
      invention('B', 'Kenya', 'Radios', 90_000),
      invention('C', 'America', 'Phones', 700),
    ]);

    expect(format?.places).toEqual([
      { key: 'KE', name: 'Kenya', versions: 1, bestViews: 90_000 },
      { key: 'US', name: 'America', versions: 2, bestViews: 5000 },
    ]);
  });
});

describe('oneWordVariants', () => {
  const index = indexBySubject(
    groupIdeas([
      video('A', 'Kenya Just Found A Fuel That Shouldn’t Exist', 500_000),
      video('B', 'Chile Just Detected A Fuel That Shouldn’t Exist', 2600),
      video('C', 'Chile Just Found An Engine That Shouldn’t Exist', 900),
      video('D', 'Peru Just Detected A Fuel That Shouldn’t Exist', 40),
      video('E', 'Chile Opens A Giant Solar Farm', 9_000_000),
    ]),
  );

  test('lists the titles one word away from an idea, most viewed first, with the word that differs', () => {
    const variants = oneWordVariants(index, '{place} just found fuel shouldn exist');

    expect(variants.map((entry) => [entry.video.title, entry.word])).toEqual([
      ['Chile Just Detected A Fuel That Shouldn’t Exist', 'detected'],
      ['Chile Just Found An Engine That Shouldn’t Exist', 'engine'],
      ['Peru Just Detected A Fuel That Shouldn’t Exist', 'detected'],
    ]);
  });

  test('is empty for an idea nothing is close to', () => {
    expect(oneWordVariants(index, '{place} opens giant solar farm')).toEqual([]);
  });
});
