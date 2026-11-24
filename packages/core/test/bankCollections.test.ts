import { beforeEach, describe, expect, test } from 'vitest';
import { collectionCsv, collectionMarkdown } from '../src/bank/exportCollection';
import { MAX_COLLECTION_NAME, collectionNameProblem } from '../src/bank/collections';
import { openDatabase, type Db } from '../src/db/sqlite';
import { SqliteCollectionRepo } from '../src/repos/sqliteCollectionRepo';
import type { BankVideo } from '../src/bank/types';

const T1 = new Date('2026-11-20T12:00:00Z');
const T2 = new Date('2026-11-21T12:00:00Z');

describe('SqliteCollectionRepo', () => {
  let db: Db;
  let repo: SqliteCollectionRepo;
  beforeEach(() => {
    db = openDatabase(':memory:');
    repo = new SqliteCollectionRepo(db);
  });

  test('makes named collections, one per name whatever its case', () => {
    const hooks = repo.create('Hooks to steal', T1);
    expect(repo.create('hooks to STEAL', T2)).toBe(hooks);
    repo.create('Thumbnail refs', T2);
    expect(repo.list().map((c) => [c.name, c.count])).toEqual([
      ['Hooks to steal', 0],
      ['Thumbnail refs', 0],
    ]);
  });

  test('keeps videos in a collection once each, newest first, and lets them go', () => {
    const id = repo.create('Hooks', T1);
    repo.add(id, 'abcdefghijk', T1);
    repo.add(id, 'bcdefghijkl', T2);
    repo.add(id, 'abcdefghijk', T2);
    expect(repo.videoIds(id)).toEqual(['bcdefghijkl', 'abcdefghijk']);
    expect(repo.membership()).toEqual(
      new Map([
        ['abcdefghijk', [id]],
        ['bcdefghijkl', [id]],
      ]),
    );
    expect(repo.remove(id, 'abcdefghijk')).toBe(true);
    expect(repo.remove(id, 'abcdefghijk')).toBe(false);
    expect(repo.list()[0]?.count).toBe(1);
  });

  test('deleting a collection takes its videos with it', () => {
    const id = repo.create('Gone', T1);
    repo.add(id, 'abcdefghijk', T1);
    expect(repo.delete(id)).toBe(true);
    expect(repo.find(id)).toBeNull();
    expect(repo.membership().size).toBe(0);
    expect(repo.delete(id)).toBe(false);
  });

  test('refuses a video id that is not one and a collection that is not there', () => {
    expect(() => repo.add(1, 'nope', T1)).toThrow();
    expect(repo.add(99, 'abcdefghijk', T1)).toBe(false);
  });
});

describe('collection names', () => {
  test('are one line, not empty and not too long', () => {
    expect(collectionNameProblem('Hooks to steal')).toBeNull();
    expect(collectionNameProblem('  ')).not.toBeNull();
    expect(collectionNameProblem('a\nb')).not.toBeNull();
    expect(collectionNameProblem('x'.repeat(MAX_COLLECTION_NAME + 1))).not.toBeNull();
  });
});

const video: BankVideo = {
  videoId: 'abcdefghijk',
  title: '=HYPERLINK("x") "quoted", title',
  views: 1_234_567,
  ageDays: 12.4,
  publishedAt: '2026-11-08T00:00:00.000Z',
  publishedRaw: '1w ago',
  durationSeconds: 754,
  isShort: false,
  score: 42.345,
  baseline: 9000,
  sampleSize: 12,
  caution: null,
  viewsPerDay: 99_560.2,
  readAt: '2026-11-20T00:00:00.000Z',
  channel: {
    id: `UC${'A'.repeat(22)}`,
    title: 'Chan | A',
    handle: '@a',
    subscribers: 5000,
    logoUrl: null,
    country: 'US',
    topic: { label: 'Cars', source: 'titles' },
    alphabet: 'latin',
    money: 'likely',
    closeness: null,
    onAMap: true,
  },
};

describe('exporting a collection', () => {
  test('as CSV with labelled columns, quoting and no spreadsheet formulas', () => {
    const csv = collectionCsv([video]);
    const [header, row] = csv.trim().split('\r\n');
    expect(header).toContain('outlier_score_x');
    expect(header).toContain('usual_views_baseline');
    expect(row).toContain('"\'=HYPERLINK(""x"") ""quoted"", title"');
    expect(row).toContain('42.3');
    expect(row).toContain('https://www.youtube.com/watch?v=abcdefghijk');
  });

  test('as Markdown, with the numbers labelled and the table cells escaped', () => {
    const md = collectionMarkdown('Hooks to steal', [video], new Date('2026-11-22T00:00:00Z'));
    expect(md).toContain('# Hooks to steal');
    expect(md).toContain('Chan \\| A');
    expect(md).toContain('42.3×');
    expect(md).toContain('1,234,567');
    expect(md).toMatch(/score is views over the channel/i);
  });
});
