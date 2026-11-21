import { beforeEach, describe, expect, test } from 'vitest';
import {
  ONE_VIDEO_PROMPTS,
  UPLOAD_KINDS,
  liftOneVideoPrompts,
  newUploadKey,
  uploadKindOf,
} from '../src/breakdown/oneVideo';
import { markerLines } from '../src/breakdown/parts';
import { openDatabase, type Db } from '../src/db/sqlite';
import {
  MAX_VIDEO_BREAKDOWN_CHARS,
  SqliteVideoBreakdownRepo,
  type VideoSeen,
} from '../src/repos/sqliteVideoBreakdownRepo';
import { VIDEO_ID_PATTERN } from '../src/sources/parse';

const T1 = new Date('2026-11-20T12:00:00Z');
const T2 = new Date('2026-11-21T09:30:00Z');
const VIDEO = 'dQw4w9WgXcQ';
const UPLOAD = 'Ab-_cdEFgh1';
const CHANNEL = `UC${'a'.repeat(22)}`;

const SEEN: VideoSeen = {
  file: 'downloaded',
  fileNote: null,
  watchedBy: 'agy',
  framesBy: 'claude',
  frameSource: 'file',
  frames: 312,
  captions: 'read',
  notes: [],
};

const marked = (name: string, body: string): string => {
  const { start, end } = markerLines(name);
  return `${start}\n${body}\n${end}`;
};

describe('the ready prompts of a one-video breakdown', () => {
  test('are lifted out of the answer, each by its own marker lines', () => {
    const text = [
      'WHAT IT IS',
      '- A ten-minute explainer [0:00].',
      marked(ONE_VIDEO_PROMPTS.script, 'Write a script about [TOPIC].'),
      marked(ONE_VIDEO_PROMPTS.visual, 'Flat vector map, muted colours.'),
      marked(ONE_VIDEO_PROMPTS.thumbnail, 'A glowing map of [SUBJECT].'),
      'WHAT TO AVOID COPYING',
      '- The narrator’s catchphrase.',
    ].join('\n');

    const lifted = liftOneVideoPrompts(text);

    expect(lifted.prompts).toEqual({
      script: 'Write a script about [TOPIC].',
      visual: 'Flat vector map, muted colours.',
      thumbnail: 'A glowing map of [SUBJECT].',
    });
    expect(lifted.body).not.toContain('===');
    expect(lifted.body).toContain('WHAT IT IS');
    expect(lifted.body).toContain('WHAT TO AVOID COPYING');
  });

  test('are null where the answer has none, or holds one twice, and the body keeps the text', () => {
    const twice = `${marked(ONE_VIDEO_PROMPTS.script, 'one')}\n${marked(ONE_VIDEO_PROMPTS.script, 'two')}`;

    const lifted = liftOneVideoPrompts(twice);

    expect(lifted.prompts).toEqual({ script: null, visual: null, thumbnail: null });
    expect(lifted.body).toBe(twice);
  });
});

describe('a video file the owner gives', () => {
  test('is known by an id of the same shape as a YouTube id, made at random', () => {
    const bytes = [0, 1, 2, 3, 4, 5, 6, 7];
    const key = newUploadKey(() => Buffer.from(bytes));

    expect(VIDEO_ID_PATTERN.test(key)).toBe(true);
    expect(key).toBe(Buffer.from(bytes).toString('base64url').slice(0, 11));
    expect(newUploadKey()).not.toBe(newUploadKey());
  });

  test('is taken only as MP4, WebM or MOV, told apart by the type the browser sends', () => {
    expect(uploadKindOf('video/mp4')).toEqual(UPLOAD_KINDS[0]);
    expect(uploadKindOf('video/webm; codecs=vp9')?.extension).toBe('.webm');
    expect(uploadKindOf('VIDEO/QUICKTIME')?.extension).toBe('.mov');
    expect(uploadKindOf('video/x-msvideo')).toBeNull();
    expect(uploadKindOf('')).toBeNull();
  });
});

describe('the kept one-video breakdowns', () => {
  let db: Db;
  let store: SqliteVideoBreakdownRepo;

  beforeEach(() => {
    db = openDatabase(':memory:');
    store = new SqliteVideoBreakdownRepo(db);
  });

  test('are absent until one has been written', () => {
    expect(store.list()).toEqual([]);
    expect(store.find(VIDEO)).toBeNull();
  });

  test('come back as written: the video, how it was seen, the engine and the text', () => {
    store.save(
      {
        videoId: VIDEO,
        source: 'youtube',
        title: 'How maps lie',
        channelId: CHANNEL,
        seen: SEEN,
        written: { engine: 'claude', text: 'WHAT IT IS\n- An explainer.' },
      },
      T1,
    );

    expect(store.find(VIDEO)).toEqual({
      videoId: VIDEO,
      source: 'youtube',
      title: 'How maps lie',
      channelId: CHANNEL,
      seen: SEEN,
      written: { engine: 'claude', text: 'WHAT IT IS\n- An explainer.' },
      problem: null,
      writtenAt: T1,
    });
  });

  test('keep a breakdown that could not be written, with the reason, and list the newest first', () => {
    store.save(
      {
        videoId: VIDEO,
        source: 'youtube',
        title: 'Old',
        channelId: null,
        seen: SEEN,
        written: { engine: 'claude', text: 'x' },
      },
      T1,
    );
    store.save(
      {
        videoId: UPLOAD,
        source: 'file',
        title: 'my clip.webm',
        channelId: null,
        seen: { ...SEEN, file: 'uploaded', captions: 'none' },
        problem: 'Claude Code reached its limit.',
      },
      T2,
    );

    expect(store.list().map((entry) => entry.videoId)).toEqual([UPLOAD, VIDEO]);
    expect(store.find(UPLOAD)).toMatchObject({
      written: null,
      problem: 'Claude Code reached its limit.',
    });
  });

  test('replace an earlier breakdown of the same video', () => {
    const entry = {
      videoId: VIDEO,
      source: 'youtube' as const,
      title: 'A',
      channelId: null,
      seen: SEEN,
    };
    store.save({ ...entry, written: { engine: 'claude', text: 'first' } }, T1);
    store.save({ ...entry, written: { engine: 'codex', text: 'second' } }, T2);

    expect(store.list()).toHaveLength(1);
    expect(store.find(VIDEO)?.written).toEqual({ engine: 'codex', text: 'second' });
  });

  test('cap a long text and title, and refuse a bad id, an empty text or a channel that is not one', () => {
    const base = { source: 'youtube' as const, channelId: null, seen: SEEN };
    store.save(
      {
        ...base,
        videoId: VIDEO,
        title: 't'.repeat(500),
        written: { engine: 'claude', text: 'w'.repeat(MAX_VIDEO_BREAKDOWN_CHARS + 10) },
      },
      T1,
    );
    expect(store.find(VIDEO)?.written?.text).toHaveLength(MAX_VIDEO_BREAKDOWN_CHARS);
    expect(store.find(VIDEO)?.title.length).toBeLessThanOrEqual(200);

    expect(() => store.save({ ...base, videoId: 'bad', title: 'x', problem: 'no' }, T1)).toThrow(
      /video id/,
    );
    expect(() =>
      store.save(
        { ...base, videoId: VIDEO, title: 'x', written: { engine: 'claude', text: ' ' } },
        T1,
      ),
    ).toThrow(/empty/);
    expect(() =>
      store.save({ ...base, videoId: VIDEO, title: 'x', channelId: 'nope', problem: 'no' }, T1),
    ).toThrow(/channel/);
  });

  test('pass over a row something else wrote badly, and read unknown "seen" facts as nothing seen', () => {
    db.prepare(
      `INSERT INTO video_breakdowns (video_id, source, title, channel_id, seen_json, engine, notes, problem, written_at)
       VALUES (?, 'youtube', 'x', NULL, '{bad', 'claude', 'text', NULL, ?)`,
    ).run(VIDEO, T1.toISOString());
    db.prepare(
      `INSERT INTO video_breakdowns (video_id, source, title, channel_id, seen_json, engine, notes, problem, written_at)
       VALUES (?, 'elsewhere', 'x', NULL, '{}', NULL, NULL, NULL, 'not a date')`,
    ).run(UPLOAD);

    expect(store.list().map((entry) => entry.videoId)).toEqual([VIDEO]);
    expect(store.find(VIDEO)?.seen).toEqual({
      file: 'none',
      fileNote: null,
      watchedBy: null,
      framesBy: null,
      frameSource: null,
      frames: null,
      captions: 'not-asked',
      notes: [],
    });
    expect(store.find(UPLOAD)).toBeNull();
  });
});
