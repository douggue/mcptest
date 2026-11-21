import { describe, expect, test } from 'vitest';
import {
  CLAIM_FILTERS,
  filterClaims,
  markerClaims,
  sourcesMarkdown,
  usedFacts,
  type ClaimView,
  type FactSheetView,
} from '../src/lib/research';

const sheet: FactSheetView = {
  conceptId: 7,
  facts: [
    { number: 1, text: 'It opened in 2020.', sources: ['https://a.example/1'] },
    {
      number: 2,
      text: 'It stores 1,600 MWh.',
      sources: ['https://b.example/2', 'https://c.example/3'],
    },
    { number: 3, text: 'Unused.', sources: ['https://d.example/4'] },
  ],
  notFound: [],
  disputed: [],
  engine: 'claude',
  writtenAt: '2026-11-21T12:00:00.000Z',
};
const SCRIPT =
  'It stores a lot [F2]. It opened in 2020 [F1]. Nobody knows why [CHECK: why]. It is old [CHECK: age].';

describe('the facts a script rests on', () => {
  test('are the sheet’s facts it names, in the order first named, and none with no sheet', () => {
    expect(usedFacts(SCRIPT, sheet).map((fact) => fact.number)).toEqual([2, 1]);
    expect(usedFacts(SCRIPT, null)).toEqual([]);
    expect(usedFacts('It opened [F9].', sheet)).toEqual([]);
  });

  test('end the Markdown file as a numbered source list', () => {
    expect(sourcesMarkdown(SCRIPT, sheet)).toEqual([
      '## Sources',
      '',
      '1. [F2] It stores 1,600 MWh. https://b.example/2 · https://c.example/3',
      '2. [F1] It opened in 2020. https://a.example/1',
      '',
    ]);
    expect(sourcesMarkdown('No facts.', sheet)).toEqual([]);
  });
});

describe('the claims beside the script', () => {
  const checked: ClaimView = {
    what: 'why',
    sentence: 'Nobody knows why.',
    verdict: 'wrong',
    why: 'It is known.',
    correction: 'The reason is known.',
    sources: ['https://e.example/5'],
    engine: 'claude',
    checkedAt: '2026-11-21T12:00:00.000Z',
  };

  test('are the markers still in the script, each with its verdict when it was checked', () => {
    const rows = markerClaims(SCRIPT, [checked]);

    expect(rows.map((row) => [row.claim.what, row.verdict?.verdict ?? null])).toEqual([
      ['why', 'wrong'],
      ['age', null],
    ]);
  });

  test('can be filtered by verdict, with unchecked ones apart', () => {
    const rows = markerClaims(SCRIPT, [checked]);

    expect(CLAIM_FILTERS.map((filter) => filter.id)).toEqual([
      'all',
      'wrong',
      'unsure',
      'confirmed',
      'unchecked',
    ]);
    expect(filterClaims(rows, 'wrong')).toHaveLength(1);
    expect(filterClaims(rows, 'unchecked').map((row) => row.claim.what)).toEqual(['age']);
    expect(filterClaims(rows, 'all')).toHaveLength(2);
  });
});
