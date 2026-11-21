import { beforeEach, describe, expect, test } from 'vitest';
import { openDatabase, type Db } from '../src/db/sqlite';
import { SqliteFormulaRepo } from '../src/repos/sqliteFormulaRepo';
import { SqliteHookLabelRepo } from '../src/repos/sqliteHookLabelRepo';

const T1 = new Date('2026-11-21T09:00:00Z');
const T2 = new Date('2026-11-21T10:00:00Z');
const CENTER = 'UCcccccccccccccccccccccc';
const OTHER = 'UCoooooooooooooooooooooo';
const A = 'aaaaaaaaaa1';
const B = 'bbbbbbbbbb1';

let db: Db;

beforeEach(() => {
  db = openDatabase(':memory:');
});

describe('stored title formulas', () => {
  const formula = (text: string) => ({
    formula: text,
    why: 'It promises a secret.',
    videoIds: [A, B],
  });

  test('come back for their channel and window, in the order given, with who found them and when', () => {
    const formulas = new SqliteFormulaRepo(db);

    formulas.replace(
      { centerChannelId: CENTER, windowDays: 90, engine: 'claude' },
      [formula('Why [Thing] Left'), formula('How [Thing] Works')],
      T1,
    );

    const stored = formulas.list(CENTER, 90);
    expect(stored.map((one) => one.formula)).toEqual(['Why [Thing] Left', 'How [Thing] Works']);
    expect(stored[0]).toMatchObject({
      centerChannelId: CENTER,
      windowDays: 90,
      why: 'It promises a secret.',
      videoIds: [A, B],
      engine: 'claude',
      runAt: T1,
    });
    expect(formulas.list(CENTER, 30)).toEqual([]);
    expect(formulas.list(OTHER, 90)).toEqual([]);
  });

  test('are replaced by the next run for the same channel and window, and by no other', () => {
    const formulas = new SqliteFormulaRepo(db);
    const scope = { centerChannelId: CENTER, windowDays: 90, engine: 'claude' };
    formulas.replace(scope, [formula('Old [Thing] Here')], T1);
    formulas.replace({ ...scope, windowDays: 30 }, [formula('Thirty [Thing] Days')], T1);
    formulas.replace({ ...scope, centerChannelId: OTHER }, [formula('Their [Thing] Here')], T1);

    formulas.replace(scope, [formula('New [Thing] Here')], T2);

    expect(formulas.list(CENTER, 90).map((one) => one.formula)).toEqual(['New [Thing] Here']);
    expect(formulas.list(CENTER, 30)).toHaveLength(1);
    expect(formulas.list(OTHER, 90)).toHaveLength(1);
  });

  test('are found by id through their own channel only', () => {
    const formulas = new SqliteFormulaRepo(db);
    formulas.replace(
      { centerChannelId: CENTER, windowDays: 90, engine: 'claude' },
      [formula('Why [Thing] Left')],
      T1,
    );
    const id = formulas.list(CENTER, 90)[0]?.id ?? 0;

    expect(formulas.find(CENTER, id)?.formula).toBe('Why [Thing] Left');
    expect(formulas.find(OTHER, id)).toBeNull();
  });

  test('refuse a window that is not a whole number of days and a video that is not a video id', () => {
    const formulas = new SqliteFormulaRepo(db);
    const scope = { centerChannelId: CENTER, windowDays: 90, engine: 'claude' };

    expect(() => formulas.replace({ ...scope, windowDays: 1.5 }, [], T1)).toThrow(/days/);
    expect(() =>
      formulas.replace(scope, [{ ...formula('Why [Thing] Left'), videoIds: ['../x'] }], T1),
    ).toThrow(/video id/);
    expect(() => formulas.replace({ ...scope, centerChannelId: 'x' }, [], T1)).toThrow(
      /channel id/,
    );
  });
});

describe('stored hook labels', () => {
  const label = (videoId: string, style: string) => ({
    videoId,
    style,
    how: 'It starts mid-scene.',
  });

  test('are kept per channel and video, the newest label replacing the one before', () => {
    const labels = new SqliteHookLabelRepo(db);
    labels.saveMany(CENTER, [label(A, 'cold open'), label(B, 'number shock')], 'claude', T1);
    labels.saveMany(OTHER, [label(A, 'their name for it')], 'claude', T1);

    labels.saveMany(CENTER, [label(A, 'open question')], 'codex', T2);

    expect(labels.list(CENTER)).toEqual([
      {
        videoId: A,
        style: 'open question',
        how: 'It starts mid-scene.',
        engine: 'codex',
        labelledAt: T2,
      },
      {
        videoId: B,
        style: 'number shock',
        how: 'It starts mid-scene.',
        engine: 'claude',
        labelledAt: T1,
      },
    ]);
    expect(labels.list(OTHER).map((one) => one.style)).toEqual(['their name for it']);
  });

  test('refuse a channel that is not a channel id, a video that is not a video id and an empty style', () => {
    const labels = new SqliteHookLabelRepo(db);

    expect(() => labels.saveMany('x', [label(A, 'cold open')], 'claude', T1)).toThrow(/channel id/);
    expect(() => labels.saveMany(CENTER, [label('../x', 'cold open')], 'claude', T1)).toThrow(
      /video id/,
    );
    expect(() => labels.saveMany(CENTER, [label(A, ' ')], 'claude', T1)).toThrow(/style/);
    expect(labels.list(CENTER)).toEqual([]);
  });
});
