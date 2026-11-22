import { beforeEach, describe, expect, test } from 'vitest';
import { openDatabase, type Db } from '../src/db/sqlite';
import { MAX_PART_CHARS, SqliteBreakdownRepo } from '../src/repos/sqliteBreakdownRepo';

const T1 = new Date('2026-11-20T12:00:00Z');
const T2 = new Date('2026-11-21T09:30:00Z');
const CHANNEL = `UC${'a'.repeat(22)}`;
const OTHER = `UC${'b'.repeat(22)}`;
const TITLES = 'THE TITLES\n- Twenty titles, most viewed first.';

let db: Db;
let parts: SqliteBreakdownRepo;

beforeEach(() => {
  db = openDatabase(':memory:');
  parts = new SqliteBreakdownRepo(db);
});

describe('the stored parts of a channel breakdown', () => {
  test('are absent until a breakdown has been written', () => {
    expect(parts.list(CHANNEL)).toEqual([]);
    expect(parts.find(CHANNEL, 'titles')).toBeNull();
  });

  test('come back as they were written, with the engine and the time', () => {
    parts.saveWritten({ channelId: CHANNEL, part: 'titles', engine: 'claude', text: TITLES }, T1);

    expect(parts.find(CHANNEL, 'titles')).toEqual({
      channelId: CHANNEL,
      part: 'titles',
      written: true,
      engine: 'claude',
      text: TITLES,
      writtenAt: T1,
    });
  });

  test('keep what a reader should know about how a part was written, and drop it when rewritten', () => {
    const caveat = {
      standInFor: { engine: 'agy', because: 'Antigravity CLI hit its limit.' },
      unseen: { shown: 10 },
    };
    parts.saveWritten(
      { channelId: CHANNEL, part: 'thumbnails', engine: 'claude', text: TITLES, caveat },
      T1,
    );
    expect(parts.find(CHANNEL, 'thumbnails')).toMatchObject({ written: true, caveat });

    parts.saveWritten({ channelId: CHANNEL, part: 'thumbnails', engine: 'agy', text: TITLES }, T2);
    expect(parts.find(CHANNEL, 'thumbnails')).not.toHaveProperty('caveat');
  });

  test('read back only a caveat that says one of its two things', () => {
    const bad = { unseen: { shown: -1 }, standInFor: { engine: '', because: 'x' }, other: 1 };
    parts.saveWritten(
      { channelId: CHANNEL, part: 'titles', engine: 'claude', text: TITLES, caveat: bad as never },
      T1,
    );
    db.prepare("UPDATE breakdown_parts SET caveat_json = 'not json' WHERE part = 'scripts'").run();
    expect(parts.find(CHANNEL, 'titles')).not.toHaveProperty('caveat');
  });

  test('keep a part that could not be written, with the reason in plain words', () => {
    parts.saveFailed(
      { channelId: CHANNEL, part: 'thumbnails', reason: 'Claude Code took too long.' },
      T1,
    );

    expect(parts.find(CHANNEL, 'thumbnails')).toEqual({
      channelId: CHANNEL,
      part: 'thumbnails',
      written: false,
      reason: 'Claude Code took too long.',
      writtenAt: T1,
    });
  });

  test('are listed in the order a breakdown is read, whatever order they were written in', () => {
    parts.saveWritten({ channelId: CHANNEL, part: 'master', engine: 'codex', text: 'M' }, T1);
    parts.saveFailed({ channelId: CHANNEL, part: 'scripts', reason: 'No.' }, T1);
    parts.saveWritten({ channelId: CHANNEL, part: 'basis', engine: 'jgtube', text: 'B' }, T1);
    parts.saveWritten({ channelId: CHANNEL, part: 'titles', engine: 'claude', text: 'T' }, T1);

    expect(parts.list(CHANNEL).map((part) => part.part)).toEqual([
      'basis',
      'titles',
      'scripts',
      'master',
    ]);
  });

  test('are replaced by a new run: a later text, or a later failure, takes the place of the old', () => {
    parts.saveWritten({ channelId: CHANNEL, part: 'plan', engine: 'claude', text: 'Old plan' }, T1);
    parts.saveWritten({ channelId: CHANNEL, part: 'plan', engine: 'codex', text: 'New plan' }, T2);

    expect(parts.find(CHANNEL, 'plan')).toMatchObject({
      written: true,
      engine: 'codex',
      text: 'New plan',
      writtenAt: T2,
    });

    parts.saveFailed({ channelId: CHANNEL, part: 'plan', reason: 'A plan limit was reached.' }, T2);

    expect(parts.find(CHANNEL, 'plan')).toMatchObject({ written: false });
    expect(parts.list(CHANNEL)).toHaveLength(1);
  });

  test('belong to one channel and are never mixed with another’s', () => {
    parts.saveWritten({ channelId: CHANNEL, part: 'titles', engine: 'claude', text: 'Mine' }, T1);
    parts.saveWritten({ channelId: OTHER, part: 'titles', engine: 'claude', text: 'Theirs' }, T1);

    expect(parts.list(CHANNEL).map((part) => part.written && part.text)).toEqual(['Mine']);
    expect(parts.list(OTHER).map((part) => part.written && part.text)).toEqual(['Theirs']);
  });

  test('are cut at a size no part comes near, so one runaway answer cannot fill the store', () => {
    const long = 'x'.repeat(MAX_PART_CHARS + 500);

    parts.saveWritten({ channelId: CHANNEL, part: 'scripts', engine: 'claude', text: long }, T1);

    const stored = parts.find(CHANNEL, 'scripts');
    expect(stored?.written && stored.text.length).toBe(MAX_PART_CHARS);
  });

  test.each([
    ['a channel id that is not one', { channelId: 'not a channel', part: 'titles' }],
    ['a part that does not exist', { channelId: CHANNEL, part: 'summary' }],
  ])('refuse %s', (_what, where) => {
    const bad = { ...where, engine: 'claude', text: 'T' } as never;

    expect(() => parts.saveWritten(bad, T1)).toThrow();
    expect(() => parts.saveFailed({ ...where, reason: 'No.' } as never, T1)).toThrow();
    expect(parts.list(CHANNEL)).toEqual([]);
  });

  test('refuse an empty text, an empty reason and a missing engine', () => {
    const at = { channelId: CHANNEL, part: 'titles' } as const;

    expect(() => parts.saveWritten({ ...at, engine: 'claude', text: '  ' }, T1)).toThrow(/empty/);
    expect(() => parts.saveWritten({ ...at, engine: ' ', text: 'T' }, T1)).toThrow(/engine/);
    expect(() => parts.saveFailed({ ...at, reason: '' }, T1)).toThrow(/reason/);
  });

  test('pass over a row something else wrote badly instead of failing', () => {
    db.prepare(
      `INSERT INTO breakdown_parts (channel_id, part, engine, notes, problem, written_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(CHANNEL, 'titles', 'claude', 'T', null, 'not a date');
    db.prepare(
      `INSERT INTO breakdown_parts (channel_id, part, engine, notes, problem, written_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(CHANNEL, 'unknown-part', 'claude', 'T', null, T1.toISOString());
    db.prepare(
      `INSERT INTO breakdown_parts (channel_id, part, engine, notes, problem, written_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(CHANNEL, 'plan', null, null, null, T1.toISOString());

    expect(parts.list(CHANNEL)).toEqual([]);
    expect(parts.find(CHANNEL, 'titles')).toBeNull();
  });

  test('live in a table of their own that an older store gains when it is opened', () => {
    const columns = db
      .prepare("SELECT name FROM pragma_table_info('breakdown_parts') ORDER BY cid")
      .all()
      .map((row) => (row as { name: string }).name);

    expect(columns).toEqual([
      'channel_id',
      'part',
      'engine',
      'notes',
      'problem',
      'written_at',
      'caveat_json',
    ]);
  });
});
