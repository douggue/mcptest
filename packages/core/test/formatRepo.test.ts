import { describe, expect, test } from 'vitest';
import { openDatabase } from '../src/db/sqlite';
import { SqliteFormatRepo, nextVersionName } from '../src/repos/sqliteFormatRepo';

const NOW = new Date('2026-11-24T10:00:00Z');
const later = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);
const CHANNEL = 'UCaaaaaaaaaaaaaaaaaaaaaa';

const fresh = () => {
  const db = openDatabase(':memory:');
  return { db, repo: new SqliteFormatRepo(db) };
};

describe('SqliteFormatRepo', () => {
  test('creates, changes and lists formats, the one changed last first', () => {
    const { repo } = fresh();
    const long = repo.create(' Long-form ', 900, NOW);
    const short = repo.create('Shorts', 50, later(1));
    expect(long).toMatchObject({
      name: 'Long-form',
      targetSeconds: 900,
      slots: {},
      suggestion: null,
    });
    const changed = repo.update(
      long.id,
      { notes: 'calm', slots: { hook: { ingredientId: 3, note: '' } } },
      later(2),
    );
    expect(changed).toMatchObject({ notes: 'calm', targetSeconds: 900, name: 'Long-form' });
    expect(repo.update(long.id, { name: 'Long', targetSeconds: null }, later(3))).toMatchObject({
      name: 'Long',
      targetSeconds: null,
      slots: { hook: { ingredientId: 3 } },
    });
    expect(repo.list().map((format) => format.id)).toEqual([long.id, short.id]);
    expect(repo.update(99, { notes: 'x' }, NOW)).toBeNull();
  });

  test('refuses a change that breaks a rule, or slots that are not slots', () => {
    const { repo } = fresh();
    expect(() => repo.create('', null, NOW)).toThrow(/name/);
    const format = repo.create('A', null, NOW);
    expect(() => repo.update(format.id, { targetSeconds: 1 }, NOW)).toThrow(/length/);
    expect(() =>
      repo.update(format.id, { slots: { colour: { ingredientId: 1, note: '' } } as never }, NOW),
    ).toThrow();
  });

  test('duplicates a format as its next version, without its suggestion', () => {
    const { repo } = fresh();
    const first = repo.create('Long-form', 600, NOW);
    repo.update(first.id, { slots: { title: { ingredientId: 2, note: 'n' } } }, NOW);
    repo.saveSuggestion(first.id, {
      slots: [{ layer: 'title', ingredientId: 2, reason: 'r' }],
      summary: 's',
      dropped: [],
      engine: 'claude',
      writtenAt: NOW.toISOString(),
    });
    expect(repo.find(first.id)?.suggestion?.engine).toBe('claude');
    const copy = repo.duplicate(first.id, later(1));
    expect(copy).toMatchObject({
      name: 'Long-form v2',
      copiedFrom: first.id,
      slots: { title: { ingredientId: 2, note: 'n' } },
      suggestion: null,
    });
    expect(repo.duplicate(99, NOW)).toBeNull();
    expect(repo.saveSuggestion(99, repo.find(first.id)!.suggestion!)).toBe(false);
  });

  test('names versions in order and keeps them short', () => {
    expect(nextVersionName('Long-form')).toBe('Long-form v2');
    expect(nextVersionName('Long-form v9')).toBe('Long-form v10');
    expect(nextVersionName('x'.repeat(60))).toHaveLength(60);
  });

  test('reads stored JSON that no longer fits as empty', () => {
    const { db, repo } = fresh();
    const format = repo.create('A', null, NOW);
    db.prepare("UPDATE formats SET slots_json = '{', suggestion_json = '[]' WHERE id = ?").run(
      format.id,
    );
    expect(repo.find(format.id)).toMatchObject({ slots: {}, suggestion: null });
  });

  test('keeps each channel’s active format, and lets it go with its format', () => {
    const { repo } = fresh();
    const format = repo.create('A', null, NOW);
    expect(repo.activeFor(CHANNEL)).toBeNull();
    expect(repo.setActive(CHANNEL, format.id, NOW)).toBe(true);
    expect(repo.activeFor(CHANNEL)?.id).toBe(format.id);
    expect(repo.setActive(CHANNEL, 99, NOW)).toBe(false);
    expect(repo.setActive(CHANNEL, null, NOW)).toBe(true);
    expect(repo.activeFor(CHANNEL)).toBeNull();
    repo.setActive(CHANNEL, format.id, NOW);
    expect(repo.remove(format.id)).toBe(true);
    expect(repo.remove(format.id)).toBe(false);
    expect(repo.activeFor(CHANNEL)).toBeNull();
    expect(() => repo.setActive('nope', null, NOW)).toThrow(/channel/);
  });
});
