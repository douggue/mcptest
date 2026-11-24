import { describe, expect, test } from 'vitest';
import { openDatabase } from '../src/db/sqlite';
import { ingredientFromFormula } from '../src/format/fromLab';
import { ingredientFromNote } from '../src/format/fromOwn';
import { SqliteIngredientRepo } from '../src/repos/sqliteIngredientRepo';
import { CENTER, FORMULA } from './formatFixtures';

const NOW = new Date('2026-11-23T10:00:00Z');
const later = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);

function fresh() {
  const db = openDatabase(':memory:');
  return { db, repo: new SqliteIngredientRepo(db) };
}

describe('SqliteIngredientRepo', () => {
  test('stores an ingredient and reads it back, proven worked out on read', () => {
    const { repo } = fresh();
    const stored = repo.add(ingredientFromFormula(CENTER, 90, FORMULA), NOW);
    expect(stored).toMatchObject({ id: 1, layer: 'title', note: '', proven: true });
    expect(stored.addedAt).toBe(NOW.toISOString());
    expect(repo.find(stored.id)).toEqual(stored);
    expect(repo.find(99)).toBeNull();
  });

  test('the same source on the same layer is kept once', () => {
    const { repo } = fresh();
    const first = repo.add(ingredientFromFormula(CENTER, 90, FORMULA), NOW);
    const again = repo.add(ingredientFromFormula(CENTER, 90, FORMULA), later(1));
    expect(again.id).toBe(first.id);
    expect(repo.list()).toHaveLength(1);
  });

  test('lists the newest first, keeps a note, and removes', () => {
    const { repo } = fresh();
    const note = repo.add(
      ingredientFromNote({ layer: 'sound', name: 'Quiet', text: 't' }, 'a'),
      NOW,
    );
    const formula = repo.add(ingredientFromFormula(CENTER, 90, FORMULA), later(5));
    expect(repo.list().map((item) => item.id)).toEqual([formula.id, note.id]);
    expect(repo.setNote(note.id, '  mine  ')).toBe(true);
    expect(repo.find(note.id)?.note).toBe('mine');
    expect(repo.setNote(99, 'x')).toBe(false);
    expect(repo.remove(formula.id)).toBe(true);
    expect(repo.remove(formula.id)).toBe(false);
    expect(repo.list()).toHaveLength(1);
  });

  test('refuses a draft that breaks a rule or will not fit', () => {
    const { repo } = fresh();
    const draft = ingredientFromNote({ layer: 'sound', name: 'Quiet', text: 't' }, 'a');
    expect(() => repo.add({ ...draft, name: '' }, NOW)).toThrow(/name/);
    expect(() => repo.add({ ...draft, media: [{ kind: 'image', file: '../x' }] }, NOW)).toThrow(
      /pictures/,
    );
    expect(() => repo.add({ ...draft, details: { text: 'x'.repeat(50_000) } }, NOW)).toThrow(
      /long/,
    );
  });

  test('leaves off a row whose stored JSON no longer reads', () => {
    const { db, repo } = fresh();
    const stored = repo.add(ingredientFromNote({ layer: 'sound', name: 'Q', text: 't' }, 'a'), NOW);
    const other = repo.add(ingredientFromNote({ layer: 'sound', name: 'R', text: 't' }, 'b'), NOW);
    db.prepare("UPDATE format_ingredients SET evidence_json = '{' WHERE id = ?").run(stored.id);
    db.prepare("UPDATE format_ingredients SET layer = 'colour' WHERE id = ?").run(other.id);
    expect(repo.list()).toEqual([]);
    expect(repo.find(stored.id)).toBeNull();
  });
});
