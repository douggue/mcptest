import { beforeEach, describe, expect, test } from 'vitest';
import { openDatabase, type Db } from '../src/db/sqlite';
import {
  MAX_STUDY_CHARS,
  STUDY_KINDS,
  SqliteVideoStudyRepo,
} from '../src/repos/sqliteVideoStudyRepo';

const T1 = new Date('2026-11-20T12:00:00Z');
const T2 = new Date('2026-11-21T09:30:00Z');
const VIDEO = 'bArCA8xnLqU';
const NOTES =
  'VOICE\n- A calm male narrator, about 150 words a minute.\nMUSIC\n- Low strings from 0:04.';
const FRAMES = 'Sheet 1, 0:00 to 4:00: maps with red arrows, then stock footage of a factory.';

let db: Db;
let studies: SqliteVideoStudyRepo;

const rows = (): unknown => db.prepare('SELECT COUNT(*) AS n FROM video_studies').get();

beforeEach(() => {
  db = openDatabase(':memory:');
  studies = new SqliteVideoStudyRepo(db);
});

describe('stored studies of a video', () => {
  test('come in two kinds: what was watched, and what the frames show', () => {
    expect(STUDY_KINDS).toEqual(['watch', 'frames']);
  });

  test('are absent until an engine has studied the video', () => {
    expect(studies.find(VIDEO, 'watch')).toBeNull();
    expect(studies.find(VIDEO, 'frames')).toBeNull();
  });

  test('come back as they were stored, for a video no crawl has read', () => {
    studies.save({ videoId: VIDEO, kind: 'watch', engine: 'agy', text: NOTES }, T1);

    expect(studies.find(VIDEO, 'watch')).toEqual({
      videoId: VIDEO,
      kind: 'watch',
      engine: 'agy',
      text: NOTES,
      frames: null,
      studiedAt: T1,
    });
  });

  test('remember where a frame study’s frames came from and how many there were', () => {
    const frames = { source: 'file', available: 948 } as const;

    studies.save({ videoId: VIDEO, kind: 'frames', engine: 'claude', text: FRAMES, frames }, T1);

    expect(studies.find(VIDEO, 'frames')?.frames).toEqual(frames);
    db.prepare("UPDATE video_studies SET frame_source = 'somewhere else'").run();
    expect(studies.find(VIDEO, 'frames')?.frames).toBeNull();
  });

  test('keep the two kinds of one video apart', () => {
    studies.save({ videoId: VIDEO, kind: 'watch', engine: 'agy', text: NOTES }, T1);
    studies.save({ videoId: VIDEO, kind: 'frames', engine: 'claude', text: FRAMES }, T2);

    expect(studies.find(VIDEO, 'watch')?.text).toBe(NOTES);
    expect(studies.find(VIDEO, 'frames')).toMatchObject({ engine: 'claude', text: FRAMES });
  });

  test('keep one row per video and kind: a later study replaces the earlier one', () => {
    studies.save({ videoId: VIDEO, kind: 'watch', engine: 'agy', text: NOTES }, T1);
    studies.save(
      { videoId: VIDEO, kind: 'watch', engine: 'gemini-api', text: 'Watched again.' },
      T2,
    );

    expect(studies.find(VIDEO, 'watch')).toEqual({
      videoId: VIDEO,
      kind: 'watch',
      engine: 'gemini-api',
      text: 'Watched again.',
      frames: null,
      studiedAt: T2,
    });
    expect(rows()).toEqual({ n: 1 });
  });

  test('keep the studies of different videos apart', () => {
    studies.save({ videoId: VIDEO, kind: 'watch', engine: 'agy', text: NOTES }, T1);
    studies.save(
      { videoId: '-aaaaaaaaaa', kind: 'watch', engine: 'agy', text: 'Another video.' },
      T1,
    );

    expect(studies.find('-aaaaaaaaaa', 'watch')?.text).toBe('Another video.');
    expect(studies.find(VIDEO, 'watch')?.text).toBe(NOTES);
  });

  test('cut a study that is far longer than any should be', () => {
    const long = 'x'.repeat(MAX_STUDY_CHARS + 500);

    studies.save({ videoId: VIDEO, kind: 'frames', engine: 'claude', text: long }, T1);

    expect(studies.find(VIDEO, 'frames')?.text).toHaveLength(MAX_STUDY_CHARS);
  });

  test.each([
    ['something that is not a video id', { videoId: '../../etc', engine: 'agy', text: NOTES }],
    ['a study with nothing in it', { videoId: VIDEO, engine: 'agy', text: '   ' }],
    ['an engine that has no name', { videoId: VIDEO, engine: '', text: NOTES }],
  ])('refuse %s', (_what, study) => {
    expect(() => studies.save({ kind: 'watch', ...study }, T1)).toThrow();
    expect(rows()).toEqual({ n: 0 });
  });

  test('treat a row something else wrote badly as no study at all', () => {
    studies.save({ videoId: VIDEO, kind: 'watch', engine: 'agy', text: NOTES }, T1);
    db.prepare("UPDATE video_studies SET studied_at = 'not a date'").run();

    expect(studies.find(VIDEO, 'watch')).toBeNull();
  });
});
