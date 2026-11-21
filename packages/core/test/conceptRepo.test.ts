import { beforeEach, describe, expect, test } from 'vitest';
import type { ConceptFields, NewBatch, NewConcept } from '../src/concepts/types';
import { openDatabase, type Db } from '../src/db/sqlite';
import { SqliteConceptRepo } from '../src/repos/sqliteConceptRepo';

const T1 = new Date('2026-11-21T09:00:00Z');
const T2 = new Date('2026-11-21T10:00:00Z');
const CENTER = 'UCcccccccccccccccccccccc';
const OTHER = 'UCoooooooooooooooooooooo';
const VIDEO_A = 'aaaaaaaaaa1';
const VIDEO_B = 'bbbbbbbbbb1';

const batchFor = (centerChannelId: string, overrides: Partial<NewBatch> = {}): NewBatch => ({
  centerChannelId,
  inspiration: [VIDEO_A, VIDEO_B],
  hookModels: [],
  format: null,
  angle: null,
  length: 'long',
  ...overrides,
});

const fields = (title: string): ConceptFields => ({
  title,
  altTitles: [`${title}, second wording`, `${title}, third wording`],
  thumbnail: 'A rusted machine in an empty hall, one lamp still on.',
  overlay: 'STILL RUNNING',
  hook: 'Nobody switched it off, and nobody knows why it still works.',
  hookStyle: null,
  restsOn: `${VIDEO_A}: the cold open on a single object.`,
  needs: 'nothing',
});

const concept = (title: string, overrides: Partial<NewConcept> = {}): NewConcept => ({
  ...fields(title),
  origin: 'batch',
  parentId: null,
  engine: 'claude',
  ...overrides,
});

let db: Db;
let concepts: SqliteConceptRepo;

beforeEach(() => {
  db = openDatabase(':memory:');
  concepts = new SqliteConceptRepo(db);
});

describe('a batch of concepts', () => {
  test('keeps what it rests on: the picked videos, the format, the angle and the length', () => {
    const basis = batchFor(CENTER, {
      format: {
        source: 'transfer',
        ref: 'why {subject} quietly disappeared',
        template: 'why {subject} quietly disappeared',
      },
      hookModels: [VIDEO_B],
      angle: 'machines that outlived their makers',
      length: 'shorts',
    });

    const id = concepts.createBatch(basis, T1);

    expect(concepts.findBatch(CENTER, id)).toEqual({ ...basis, id, createdAt: T1 });
  });

  test('is not found from another channel', () => {
    const id = concepts.createBatch(batchFor(CENTER), T1);

    expect(concepts.findBatch(OTHER, id)).toBeNull();
  });

  test('refuses a centre that is not a channel id and a picked video that is not a video id', () => {
    expect(() => concepts.createBatch(batchFor('my channel'), T1)).toThrow(/channel id/);
    expect(() => concepts.createBatch(batchFor(CENTER, { inspiration: ['../x'] }), T1)).toThrow(
      /video id/,
    );
  });
});

describe('stored concepts', () => {
  test('come back as they were stored, in the order they were written, not kept', () => {
    const batchId = concepts.createBatch(batchFor(CENTER), T1);

    const stored = concepts.addConcepts(batchId, [concept('First'), concept('Second')], T1);

    expect(stored.map((one) => one.title)).toEqual(['First', 'Second']);
    expect(stored[0]).toMatchObject({
      ...concept('First'),
      batchId,
      centerChannelId: CENTER,
      kept: false,
      createdAt: T1,
    });
    expect(concepts.listForCenter(CENTER)).toEqual(stored);
  });

  test('are listed for their own channel only', () => {
    const mine = concepts.createBatch(batchFor(CENTER), T1);
    const theirs = concepts.createBatch(batchFor(OTHER), T1);
    concepts.addConcepts(mine, [concept('Mine')], T1);
    const [other] = concepts.addConcepts(theirs, [concept('Theirs')], T1);

    expect(concepts.listForCenter(CENTER).map((one) => one.title)).toEqual(['Mine']);
    expect(concepts.find(CENTER, other?.id ?? 0)).toBeNull();
    expect(concepts.find(OTHER, other?.id ?? 0)?.title).toBe('Theirs');
  });

  test('list the kept ones first, then the newest batch', () => {
    const first = concepts.createBatch(batchFor(CENTER), T1);
    const [old, keeper] = concepts.addConcepts(first, [concept('Old'), concept('Keeper')], T1);
    const second = concepts.createBatch(batchFor(CENTER), T2);
    concepts.addConcepts(second, [concept('New')], T2);

    concepts.setKept(CENTER, keeper?.id ?? 0, true);

    expect(concepts.listForCenter(CENTER).map((one) => one.title)).toEqual([
      'Keeper',
      'New',
      'Old',
    ]);
    expect(old?.kept).toBe(false);
  });

  test('can be kept and let go again, but only through their own channel', () => {
    const batchId = concepts.createBatch(batchFor(CENTER), T1);
    const [one] = concepts.addConcepts(batchId, [concept('One')], T1);
    const id = one?.id ?? 0;

    expect(concepts.setKept(OTHER, id, true)).toBe(false);
    expect(concepts.find(CENTER, id)?.kept).toBe(false);
    expect(concepts.setKept(CENTER, id, true)).toBe(true);
    expect(concepts.find(CENTER, id)?.kept).toBe(true);
    expect(concepts.setKept(CENTER, id, false)).toBe(true);
    expect(concepts.find(CENTER, id)?.kept).toBe(false);
  });

  test('remember which library hook their opening follows the way of', () => {
    const batchId = concepts.createBatch(batchFor(CENTER), T1);

    const [stored] = concepts.addConcepts(
      batchId,
      [concept('Modelled', { hookStyle: `${VIDEO_B}: cold open` })],
      T1,
    );

    expect(concepts.find(CENTER, stored?.id ?? 0)?.hookStyle).toBe(`${VIDEO_B}: cold open`);
  });

  test('remember which concept a twist or a more-like-this came from', () => {
    const batchId = concepts.createBatch(batchFor(CENTER), T1);
    const [parent] = concepts.addConcepts(batchId, [concept('Parent')], T1);

    const [twist] = concepts.addConcepts(
      batchId,
      [concept('Twist', { origin: 'twist', parentId: parent?.id ?? null })],
      T2,
    );

    expect(twist).toMatchObject({ origin: 'twist', parentId: parent?.id, batchId });
    expect(concepts.listForCenter(CENTER).map((one) => one.title)).toEqual(['Parent', 'Twist']);
  });

  test('refuse a concept with an empty field, storing none of its batch', () => {
    const batchId = concepts.createBatch(batchFor(CENTER), T1);

    expect(() =>
      concepts.addConcepts(batchId, [concept('Fine'), concept('Bad', { hook: '  ' })], T1),
    ).toThrow(/hook/);
    expect(concepts.listForCenter(CENTER)).toEqual([]);
  });

  test('cannot be added to a batch that does not exist', () => {
    expect(() => concepts.addConcepts(99, [concept('Lost')], T1)).toThrow(/batch/);
  });
});

describe('concepts not kept', () => {
  test('are removed when a new batch replaces them, in that channel only', () => {
    const first = concepts.createBatch(batchFor(CENTER), T1);
    const [keeper] = concepts.addConcepts(first, [concept('Keeper'), concept('Dropped')], T1);
    concepts.setKept(CENTER, keeper?.id ?? 0, true);
    const elsewhere = concepts.createBatch(batchFor(OTHER), T1);
    concepts.addConcepts(elsewhere, [concept('Elsewhere')], T1);
    const second = concepts.createBatch(batchFor(CENTER), T2);

    concepts.addConcepts(second, [concept('Fresh')], T2, { replaceUnkept: true });

    expect(concepts.listForCenter(CENTER).map((one) => one.title)).toEqual(['Keeper', 'Fresh']);
    expect(concepts.listForCenter(OTHER).map((one) => one.title)).toEqual(['Elsewhere']);
  });

  test('stay when a twist adds to their batch', () => {
    const batchId = concepts.createBatch(batchFor(CENTER), T1);
    concepts.addConcepts(batchId, [concept('Parent')], T1);

    concepts.addConcepts(batchId, [concept('Twist', { origin: 'twist' })], T2);

    expect(concepts.listForCenter(CENTER)).toHaveLength(2);
  });

  test('are cleared on request, with the batches left empty, and the count is given', () => {
    const first = concepts.createBatch(batchFor(CENTER), T1);
    concepts.addConcepts(first, [concept('A'), concept('B')], T1);
    const second = concepts.createBatch(batchFor(CENTER), T2);
    const [keeper] = concepts.addConcepts(second, [concept('Keeper'), concept('C')], T2);
    concepts.setKept(CENTER, keeper?.id ?? 0, true);
    const elsewhere = concepts.createBatch(batchFor(OTHER), T1);
    concepts.addConcepts(elsewhere, [concept('Elsewhere')], T1);

    const removed = concepts.clearUnkept(CENTER);

    expect(removed).toBe(3);
    expect(concepts.listForCenter(CENTER).map((one) => one.title)).toEqual(['Keeper']);
    expect(concepts.findBatch(CENTER, first)).toBeNull();
    expect(concepts.findBatch(CENTER, second)).not.toBeNull();
    expect(concepts.listForCenter(OTHER)).toHaveLength(1);
  });

  test('a batch that ended with nothing stored can be taken away again', () => {
    const empty = concepts.createBatch(batchFor(CENTER), T1);
    const full = concepts.createBatch(batchFor(CENTER), T1);
    concepts.addConcepts(full, [concept('Kept on')], T1);

    concepts.removeBatchIfEmpty(empty);
    concepts.removeBatchIfEmpty(full);

    expect(concepts.findBatch(CENTER, empty)).toBeNull();
    expect(concepts.findBatch(CENTER, full)).not.toBeNull();
  });
});
