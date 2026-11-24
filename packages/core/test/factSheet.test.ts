import { describe, expect, test } from 'vitest';
import {
  MAX_FACTS,
  MAX_SOURCES_PER_FACT,
  factRefs,
  httpsSource,
  parseFactSheet,
  sentencesOnFacts,
} from '../src/research/factSheet';
import { cleanVoiceover, countWords } from '../src/script/measure';

const SHEET = [
  'FACT 1: The plant in Moss Landing, California, opened in 2020 and stores 1,600 MWh.',
  'SOURCE: https://example.org/moss-landing',
  'SOURCE: http://insecure.example/moss',
  'FACT 2: Form Energy was founded in 2017 in Somerville, Massachusetts.',
  'SOURCE: https://formenergy.example/about',
  'SOURCE: https://news.example/form',
  'SOURCE: https://third.example/too-many',
  'FACT 3: A fact with no https source at all.',
  'SOURCE: ftp://files.example/x',
  'NOT FOUND: The exact cost per kilowatt-hour.',
  'DISPUTED: Whether the first plant runs for 100 hours; two sources differ.',
].join('\n');

describe('a fact sheet from a web research run', () => {
  test('keeps numbered facts with only their https sources, one or two each', () => {
    const sheet = parseFactSheet(SHEET);

    expect(sheet.facts).toEqual([
      {
        number: 1,
        text: 'The plant in Moss Landing, California, opened in 2020 and stores 1,600 MWh.',
        sources: ['https://example.org/moss-landing'],
      },
      {
        number: 2,
        text: 'Form Energy was founded in 2017 in Somerville, Massachusetts.',
        sources: ['https://formenergy.example/about', 'https://news.example/form'],
      },
    ]);
    expect(MAX_SOURCES_PER_FACT).toBe(2);
  });

  test('drops a fact with no https source, and keeps what could not be found or is disputed', () => {
    const sheet = parseFactSheet(SHEET);

    expect(sheet.facts.map((fact) => fact.number)).not.toContain(3);
    expect(sheet.notFound).toEqual([
      'The exact cost per kilowatt-hour.',
      'A fact with no https source at all.',
    ]);
    expect(sheet.disputed).toEqual([
      'Whether the first plant runs for 100 hours; two sources differ.',
    ]);
  });

  test('takes at most the most facts a sheet holds, and refuses an empty answer', () => {
    const many = Array.from({ length: MAX_FACTS + 5 }, (_, n) =>
      [`FACT ${n + 1}: Fact ${n + 1}.`, `SOURCE: https://s.example/${n}`].join('\n'),
    ).join('\n');

    expect(parseFactSheet(many).facts).toHaveLength(MAX_FACTS);
    expect(parseFactSheet('Sorry, I could not search.').facts).toEqual([]);
  });
});

describe('a fact too long to keep', () => {
  const long = `The plant ${'opened and was built and '.repeat(30)}closed.`;
  const answer = [
    'FACT 1: A short fact.',
    'SOURCE: https://a.example/1',
    `FACT 2: ${long}`,
    'SOURCE: https://a.example/2',
    'FACT 3: Another short fact.',
    'SOURCE: https://a.example/3',
  ].join('\n');

  test('is left off the sheet whole, never cut, and the sheet says so', () => {
    const sheet = parseFactSheet(answer);

    expect(sheet.facts.map((fact) => fact.number)).toEqual([1, 3]);
    expect(sheet.notFound).toHaveLength(1);
    expect(sheet.notFound[0]).toMatch(/^Fact 2 was left off the sheet: it ran to \d+ characters/);
    expect(sheet.notFound[0]).toMatch(/It began: The plant opened/);
  });

  test('does not hand its source to the fact before it', () => {
    expect(parseFactSheet(answer).facts[0]?.sources).toEqual(['https://a.example/1']);
  });

  test('a fact of 60 ordinary words is kept as written', () => {
    const sixty = `${Array.from({ length: 60 }, () => 'battery').join(' ')}.`;

    const sheet = parseFactSheet(`FACT 1: ${sixty}\nSOURCE: https://a.example/1`);

    expect(sheet.facts[0]?.text).toBe(sixty);
  });
});

describe('an https source', () => {
  test('is a plain https address with a host and no credentials, else nothing', () => {
    expect(httpsSource('https://example.org/a?b=1')).toBe('https://example.org/a?b=1');
    expect(httpsSource('http://example.org')).toBeNull();
    expect(httpsSource('https://user:pass@example.org')).toBeNull();
    expect(httpsSource('javascript:alert(1)')).toBeNull();
    expect(httpsSource('not a url')).toBeNull();
    expect(httpsSource(`https://example.org/${'a'.repeat(600)}`)).toBeNull();
  });
});

describe('a fact marker in a script', () => {
  const script =
    '## HOOK\nIt opened in 2020 [F1]. It stores a lot [F1] [F2]. Nobody knows why [CHECK: why].';

  test('names the facts a script rests on, each once', () => {
    expect(factRefs(script)).toEqual([1, 2]);
  });

  test('counts the sentences resting on a sourced fact and those still unchecked', () => {
    expect(sentencesOnFacts(script)).toEqual({ sourced: 2, unchecked: 1 });
  });

  test('is never spoken and never counted as a word', () => {
    expect(cleanVoiceover(script)).toBe('It opened in 2020. It stores a lot. Nobody knows why.');
    expect(countWords(script)).toBe(11);
  });
});
