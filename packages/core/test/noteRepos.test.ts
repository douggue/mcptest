import { beforeEach, describe, expect, test } from 'vitest';
import { openDatabase, type Db } from '../src/db/sqlite';
import { MAX_NOTE_CHARS, SqliteChannelNoteRepo } from '../src/repos/sqliteChannelNoteRepo';
import { SqliteChannelRepo } from '../src/repos/sqliteChannelRepo';
import { SqliteConceptRepo } from '../src/repos/sqliteConceptRepo';
import {
  MAX_LEARNED_FROM,
  SqliteConceptThumbnailRepo,
} from '../src/repos/sqliteConceptThumbnailRepo';

const NOW = new Date('2026-11-21T12:00:00Z');
const LATER = new Date('2026-11-22T12:00:00Z');
const MINE = `UC${'m'.repeat(22)}`;
const OTHER = `UC${'o'.repeat(22)}`;
const vid = (letter: string) => letter.repeat(11);

let db: Db;

beforeEach(() => {
  db = openDatabase(':memory:');
});

describe('what an engine wrote for a channel', () => {
  test('is kept per channel and kind, and replaced by a new run', () => {
    const notes = new SqliteChannelNoteRepo(db);
    const note = { channelId: MINE, kind: 'thumbnail-review' as const, engine: 'claude' };

    notes.save({ ...note, text: 'First review.' }, NOW);
    notes.save({ ...note, text: 'Second review.' }, LATER);
    notes.save({ ...note, kind: 'style-lock', text: 'A style.' }, NOW);

    expect(notes.find(MINE, 'thumbnail-review')).toEqual({
      ...note,
      text: 'Second review.',
      writtenAt: LATER,
    });
    expect(notes.find(MINE, 'style-lock')?.text).toBe('A style.');
    expect(notes.find(OTHER, 'thumbnail-review')).toBeNull();
    expect(notes.find(MINE, 'video-ideas')).toBeNull();
  });

  test('can be removed', () => {
    const notes = new SqliteChannelNoteRepo(db);
    notes.save({ channelId: MINE, kind: 'style-lock', engine: 'claude', text: 'A style.' }, NOW);

    notes.remove(MINE, 'style-lock');

    expect(notes.find(MINE, 'style-lock')).toBeNull();
  });

  test('refuses what is not a note', () => {
    const notes = new SqliteChannelNoteRepo(db);
    const good = { channelId: MINE, kind: 'style-lock' as const, engine: 'claude', text: 'x' };

    expect(() => notes.save({ ...good, channelId: 'nope' }, NOW)).toThrow(/channel id/);
    expect(() => notes.save({ ...good, text: '  ' }, NOW)).toThrow(/empty/);
    expect(() => notes.save({ ...good, engine: '' }, NOW)).toThrow(/engine/);
    expect(() => notes.save({ ...good, kind: 'other' as never }, NOW)).toThrow(/kind/);
  });

  test('keeps no more of a text than a note can be', () => {
    const notes = new SqliteChannelNoteRepo(db);

    notes.save(
      {
        channelId: MINE,
        kind: 'style-lock',
        engine: 'claude',
        text: 'x'.repeat(MAX_NOTE_CHARS + 50),
      },
      NOW,
    );

    expect(notes.find(MINE, 'style-lock')?.text).toHaveLength(MAX_NOTE_CHARS);
  });
});

describe('a concept’s thumbnail prompt', () => {
  /** One concept of MINE, stored the way the idea lab stores it. */
  function conceptOf(center: string): number {
    new SqliteChannelRepo(db).upsert(
      {
        id: center,
        title: 'A',
        handle: null,
        subscribers: 1,
        subscribersHidden: false,
        videoCount: 1,
      },
      NOW,
    );
    const concepts = new SqliteConceptRepo(db);
    const batchId = concepts.createBatch(
      {
        centerChannelId: center,
        inspiration: [vid('a')],
        hookModels: [],
        format: null,
        angle: null,
        length: 'long',
      },
      NOW,
    );
    const [stored] = concepts.addConcepts(
      batchId,
      [
        {
          title: 'A title',
          altTitles: ['One', 'Two'],
          thumbnail: 'a thing',
          overlay: 'WORDS',
          hook: 'An opening.',
          hookStyle: null,
          restsOn: vid('a'),
          needs: 'what to look up',
          origin: 'batch',
          parentId: null,
          engine: 'claude',
        },
      ],
      NOW,
    );
    if (!stored) throw new Error('no concept stored');
    return stored.id;
  }

  const thumbnail = {
    prompt: 'A wide photo of [SUBJECT].',
    why: 'Dark photos with red words win.',
    learnedFrom: [vid('a'), vid('b')],
    engine: 'claude',
  };

  test('is stored with its concept and read through the concept’s channel', () => {
    const thumbnails = new SqliteConceptThumbnailRepo(db);
    const id = conceptOf(MINE);

    thumbnails.save(id, thumbnail, NOW);

    expect(thumbnails.find(MINE, id)).toEqual({ ...thumbnail, conceptId: id, writtenAt: NOW });
    expect(thumbnails.find(OTHER, id)).toBeNull();
    expect(thumbnails.find(MINE, id + 1)).toBeNull();
  });

  test('is replaced by a new run and goes when its concept goes', () => {
    const thumbnails = new SqliteConceptThumbnailRepo(db);
    const id = conceptOf(MINE);
    thumbnails.save(id, thumbnail, NOW);

    thumbnails.save(id, { ...thumbnail, prompt: 'Another.', learnedFrom: [] }, LATER);
    expect(thumbnails.find(MINE, id)).toMatchObject({ prompt: 'Another.', learnedFrom: [] });

    new SqliteConceptRepo(db).clearUnkept(MINE);
    expect(thumbnails.find(MINE, id)).toBeNull();
  });

  test('refuses an empty prompt, a missing engine, a bad id and a concept that does not exist', () => {
    const thumbnails = new SqliteConceptThumbnailRepo(db);
    const id = conceptOf(MINE);

    expect(() => thumbnails.save(id, { ...thumbnail, prompt: ' ' }, NOW)).toThrow(/empty/);
    expect(() => thumbnails.save(id, { ...thumbnail, engine: '' }, NOW)).toThrow(/engine/);
    expect(() => thumbnails.save(id, { ...thumbnail, learnedFrom: ['x'] }, NOW)).toThrow();
    expect(() => thumbnails.save(id + 99, thumbnail, NOW)).toThrow();
  });

  test('keeps no more videos than a prompt is shown beside', () => {
    const thumbnails = new SqliteConceptThumbnailRepo(db);
    const id = conceptOf(MINE);
    const many = Array.from({ length: MAX_LEARNED_FROM + 3 }, (_, n) =>
      String(n).padStart(11, 'v'),
    );

    thumbnails.save(id, { ...thumbnail, learnedFrom: many }, NOW);

    expect(thumbnails.find(MINE, id)?.learnedFrom).toHaveLength(MAX_LEARNED_FROM);
  });
});
