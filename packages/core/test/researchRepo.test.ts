import { beforeEach, describe, expect, test } from 'vitest';
import { openDatabase, type Db } from '../src/db/sqlite';
import { SqliteConceptRepo } from '../src/repos/sqliteConceptRepo';
import { SqliteResearchRepo } from '../src/repos/sqliteResearchRepo';

const AT = new Date('2026-11-21T12:00:00Z');
const MINE = `UC${'m'.repeat(22)}`;
const OTHER = `UC${'o'.repeat(22)}`;

let db: Db;
let repo: SqliteResearchRepo;
let conceptId: number;

beforeEach(() => {
  db = openDatabase(':memory:');
  const concepts = new SqliteConceptRepo(db);
  const batch = concepts.createBatch(
    {
      centerChannelId: MINE,
      inspiration: ['aaaaaaaaaa1'],
      hookModels: [],
      format: null,
      angle: null,
      length: 'long',
    },
    AT,
  );
  const [stored] = concepts.addConcepts(
    batch,
    [
      {
        title: 'T',
        altTitles: ['A', 'B'],
        thumbnail: 'x',
        overlay: 'y',
        hook: 'h',
        hookStyle: null,
        restsOn: 'r',
        needs: 'n',
        origin: 'batch',
        parentId: null,
        engine: 'claude',
      },
    ],
    AT,
  );
  conceptId = stored?.id ?? 0;
  repo = new SqliteResearchRepo(db);
});

const sheet = {
  facts: [{ number: 1, text: 'It opened in 2020.', sources: ['https://a.example/b'] }],
  notFound: ['The cost.'],
  disputed: [],
};

describe('a concept’s fact sheet', () => {
  test('is kept for its concept, read only through its own channel, and replaced by a new run', () => {
    repo.saveSheet(conceptId, sheet, 'claude', AT);

    expect(repo.findSheet(MINE, conceptId)).toEqual({
      ...sheet,
      conceptId,
      engine: 'claude',
      writtenAt: AT,
    });
    expect(repo.findSheet(OTHER, conceptId)).toBeNull();
    repo.saveSheet(conceptId, { ...sheet, notFound: [] }, 'claude', AT);
    expect(repo.findSheet(MINE, conceptId)?.notFound).toEqual([]);
  });

  test('reads a damaged row as no facts rather than failing', () => {
    repo.saveSheet(conceptId, sheet, 'claude', AT);
    db.prepare("UPDATE concept_research SET facts_json = 'nonsense'").run();

    expect(repo.findSheet(MINE, conceptId)?.facts).toEqual([]);
  });
});

describe('a script’s claims check', () => {
  const claim = { what: 'the year', sentence: 'It opened in 2019.' };
  const verdict = {
    verdict: 'wrong' as const,
    why: 'It was 2020.',
    correction: 'It opened in 2020.',
    sources: ['https://a.example/b'],
  };

  test('keeps a verdict per claim, replaces it on a new check, and forgets one on request', () => {
    repo.saveClaims(conceptId, [{ ...claim, ...verdict }], 'claude', AT);
    repo.saveClaims(
      conceptId,
      [{ ...claim, ...verdict, verdict: 'unsure', correction: null }],
      'claude',
      AT,
    );

    expect(repo.listClaims(MINE, conceptId)).toEqual([
      {
        ...claim,
        ...verdict,
        verdict: 'unsure',
        correction: null,
        engine: 'claude',
        checkedAt: AT,
      },
    ]);
    expect(repo.listClaims(OTHER, conceptId)).toEqual([]);
    repo.removeClaim(conceptId, claim.what, claim.sentence);
    expect(repo.listClaims(MINE, conceptId)).toEqual([]);
  });
});

describe('the length the owner typed', () => {
  test('is kept as minutes or words, the last typed', () => {
    expect(repo.findLength(MINE, conceptId)).toBeNull();
    repo.saveLength(conceptId, { typed: 'words', words: 1800 }, AT);
    expect(repo.findLength(MINE, conceptId)).toEqual({ typed: 'words', words: 1800 });
    repo.saveLength(conceptId, { typed: 'minutes', words: null }, AT);
    expect(repo.findLength(MINE, conceptId)).toEqual({ typed: 'minutes', words: null });
    expect(repo.findLength(OTHER, conceptId)).toBeNull();
  });
});
