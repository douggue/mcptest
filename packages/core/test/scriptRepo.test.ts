import { beforeEach, describe, expect, test } from 'vitest';
import { openDatabase, type Db } from '../src/db/sqlite';
import { SqliteConceptRepo } from '../src/repos/sqliteConceptRepo';
import { MAX_SCRIPT_CHARS, SqliteScriptRepo } from '../src/repos/sqliteScriptRepo';
import { EMPTY_SCRIPT } from '../src/script/types';

const T1 = new Date('2026-11-21T09:00:00Z');
const T2 = new Date('2026-11-21T10:00:00Z');
const CENTER = 'UCcccccccccccccccccccccc';
const OTHER = 'UCoooooooooooooooooooooo';
const A = 'aaaaaaaaaa1';

let db: Db;
let concepts: SqliteConceptRepo;
let scripts: SqliteScriptRepo;
let conceptId: number;

beforeEach(() => {
  db = openDatabase(':memory:');
  concepts = new SqliteConceptRepo(db);
  scripts = new SqliteScriptRepo(db);
  const batchId = concepts.createBatch(
    {
      centerChannelId: CENTER,
      inspiration: [A],
      hookModels: [],
      format: null,
      angle: null,
      length: 'long',
    },
    T1,
  );
  const [stored] = concepts.addConcepts(
    batchId,
    [
      {
        title: 'The Machine Nobody Switched Off',
        altTitles: ['One', 'Two'],
        thumbnail: 'A press.',
        overlay: 'STILL RUNNING',
        hook: 'Nobody switched it off.',
        hookStyle: null,
        restsOn: `${A}: the cold open.`,
        needs: 'nothing',
        origin: 'batch',
        parentId: null,
        engine: 'claude',
      },
    ],
    T1,
  );
  conceptId = stored?.id ?? 0;
});

describe('a script', () => {
  test('does not exist until it is started, and starting it keeps its concept', () => {
    expect(scripts.find(CENTER, conceptId)).toBeNull();

    expect(scripts.save(CENTER, conceptId, {}, T1)).toBe(true);

    expect(scripts.find(CENTER, conceptId)).toEqual({
      ...EMPTY_SCRIPT,
      conceptId,
      centerChannelId: CENTER,
      updatedAt: T1,
    });
    expect(concepts.find(CENTER, conceptId)?.kept).toBe(true);
  });

  test('keeps what each stage and the owner put in it, changing only what is given', () => {
    scripts.save(
      CENTER,
      conceptId,
      {
        status: 'drafting',
        voiceChannelId: OTHER,
        wordsPerMinute: 152,
        targetSeconds: 600,
        targetGrade: 6.4,
        hookModels: [A],
        hooks: [{ way: 'cold open', model: A, text: 'It never stopped.' }],
      },
      T1,
    );

    scripts.save(
      CENTER,
      conceptId,
      { chosenHook: 'It never stopped.', beats: '1:00 | Why | The bill' },
      T2,
    );

    expect(scripts.find(CENTER, conceptId)).toEqual({
      conceptId,
      centerChannelId: CENTER,
      status: 'drafting',
      voiceChannelId: OTHER,
      wordsPerMinute: 152,
      targetSeconds: 600,
      targetGrade: 6.4,
      hookModels: [A],
      hooks: [{ way: 'cold open', model: A, text: 'It never stopped.' }],
      chosenHook: 'It never stopped.',
      beats: '1:00 | Why | The bill',
      draft: '',
      tightened: '',
      updatedAt: T2,
    });
  });

  test('is read and changed through its own channel only', () => {
    scripts.save(CENTER, conceptId, { draft: 'Mine.' }, T1);

    expect(scripts.save(OTHER, conceptId, { draft: 'Theirs.' }, T2)).toBe(false);
    expect(scripts.find(OTHER, conceptId)).toBeNull();
    expect(scripts.find(CENTER, conceptId)?.draft).toBe('Mine.');
    expect(scripts.save(CENTER, 999, {}, T1)).toBe(false);
  });

  test('is listed for its channel with where it stands', () => {
    scripts.save(CENTER, conceptId, { status: 'ready' }, T2);

    expect(scripts.list(CENTER)).toEqual([{ conceptId, status: 'ready', updatedAt: T2 }]);
    expect(scripts.list(OTHER)).toEqual([]);
  });

  test('refuses what could not be a script: an unknown status, a model that is not a video id, a book', () => {
    expect(() => scripts.save(CENTER, conceptId, { status: 'published' as never }, T1)).toThrow(
      /status/,
    );
    expect(() => scripts.save(CENTER, conceptId, { hookModels: ['../x'] }, T1)).toThrow(/video id/);
    expect(() => scripts.save(CENTER, conceptId, { hookModels: [A, A, A, A] }, T1)).toThrow(
      /three/,
    );
    expect(() =>
      scripts.save(CENTER, conceptId, { draft: 'x'.repeat(MAX_SCRIPT_CHARS + 1) }, T1),
    ).toThrow(/long/);
    expect(() => scripts.save(CENTER, conceptId, { wordsPerMinute: -5 }, T1)).toThrow(/rate/);
  });

  test('protects its concept: a concept with a script is not cleared, kept or not', () => {
    scripts.save(CENTER, conceptId, { draft: 'Mine.' }, T1);
    concepts.setKept(CENTER, conceptId, false);

    const removed = concepts.clearUnkept(CENTER);

    expect(removed).toBe(0);
    expect(scripts.find(CENTER, conceptId)?.draft).toBe('Mine.');
    expect(concepts.find(CENTER, conceptId)).not.toBeNull();
  });
});
