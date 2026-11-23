import { describe, expect, test } from 'vitest';
import {
  NICHE_TOPICS,
  OTHER_TOPIC,
  assignTopics,
  topicFromWords,
  type TopicInput,
} from '../src/niches/topic';

const input = (id: string, titles: readonly string[], brand?: TopicInput['brand']): TopicInput => ({
  id,
  titles,
  brand: brand ?? null,
});

describe('the topic table', () => {
  test('names each topic once, and Other is not one of them', () => {
    const labels = NICHE_TOPICS.map((topic) => topic.label);
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels).not.toContain(OTHER_TOPIC);
    expect(labels).toEqual(
      expect.arrayContaining([
        'Engineering & inventions',
        'Geopolitics',
        'Cars',
        'History',
        'Finance',
      ]),
    );
  });

  test('gives no word to two topics', () => {
    const words = NICHE_TOPICS.flatMap((topic) => topic.words);
    expect(new Set(words).size).toBe(words.length);
  });
});

describe('topicFromWords', () => {
  const flat = () => 1;

  test('picks the topic with the most weight behind it', () => {
    expect(topicFromWords(['tesla', 'cars', 'engine', 'stock'], flat)).toBe('Cars');
    expect(topicFromWords(['ancient', 'empire', 'roman'], flat)).toBe('History');
  });

  test('says Other on a single hit or a tie', () => {
    expect(topicFromWords(['tesla', 'video', 'today'], flat)).toBeNull();
    expect(topicFromWords(['tesla', 'cars', 'stock', 'investing'], flat)).toBeNull();
    expect(topicFromWords([], flat)).toBeNull();
  });

  test('reads plurals as their word', () => {
    expect(topicFromWords(['inventions', 'engineers'], flat)).toBe('Engineering & inventions');
  });
});

describe('assignTopics', () => {
  test('takes the channel’s own keywords and description first', () => {
    const topics = assignTopics([
      input('a', ['Ancient Rome Explained', 'The Fall of an Empire'], {
        keywords: ['tesla', 'electric vehicle', 'cars'],
        description: 'Car news',
      }),
    ]);
    expect(topics.get('a')).toEqual({ label: 'Cars', source: 'keywords' });
  });

  test('reads the titles when the keywords say nothing clear', () => {
    const topics = assignTopics([
      input('a', ['Ancient Rome Explained', 'The Fall of an Empire', 'Medieval Castles'], {
        keywords: ['videos'],
        description: '',
      }),
    ]);
    expect(topics.get('a')).toEqual({ label: 'History', source: 'titles' });
  });

  test('weights a title word by how rare it is across the list', () => {
    // Every channel says "war", so it counts for little; this one's "stock" and "market" decide.
    const common = (id: string) => input(id, ['War Update', 'War Today', 'War Again']);
    const topics = assignTopics([
      common('b'),
      common('c'),
      common('d'),
      input('a', ['War Stock Market', 'War Stock Crash', 'War News']),
    ]);
    expect(topics.get('a')?.label).toBe('Finance');
    expect(topics.get('b')?.label).toBe('Geopolitics');
  });

  test('says Other when nothing points anywhere', () => {
    const topics = assignTopics([input('a', ['My Day', 'Another Vlog'])]);
    expect(topics.get('a')).toEqual({ label: OTHER_TOPIC, source: 'none' });
  });
});
