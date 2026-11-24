import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { migrate, openDatabase } from '../src/db/sqlite';
import { SqliteTeardownRepo } from '../src/repos/sqliteTeardownRepo';
import {
  chapterSheetFile,
  cutChapterSheets,
  readTeardownImage,
  teardownFolder,
  teardownImages,
} from '../src/teardown/folder';
import { teardownMarkdown } from '../src/teardown/markdown';
import { MEASURED } from './teardownFixture';
import { buildTeardownReport, type TeardownInput } from '../src/teardown/report';
import { checkStage, liftJson, secondsOf } from '../src/teardown/stages';
import { zipFiles } from '../src/teardown/zip';
import { findProgram } from '../src/downloads/program';

const VIDEO = 'abcdefghijk';
let root: string;
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'jgtube-report-'));
});
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

const stage = (data: unknown) => ({ engine: 'claude', json: JSON.stringify(data) });

export const FULL_INPUT: TeardownInput = {
  videoId: VIDEO,
  about: {
    title: 'A test video',
    source: 'youtube',
    channelId: null,
    seen: ['Measured from a 720p copy.'],
  },
  measured: MEASURED,
  measuredProblem: null,
  transcript: {
    source: 'captions',
    lines: [
      { at: 1, text: 'This is how it starts. One person.' },
      { at: 65, text: 'And then it ends.' },
    ],
  },
  sheets: { '1': 'chapter-01.jpg' },
  stages: {
    structure: stage({
      format: 'A dark explainer',
      summary: 'Two acts.',
      chapters: [
        { title: 'Hook', role: 'hook', summary: 'Opens', start: 0, end: '1:00' },
        { title: 'Body', role: 'body', summary: 'Middle', start: 60, end: 120 },
      ],
    }),
    watch: stage({
      voice: 'Calm male voice',
      chapters: [{ start: 0, end: 60, sound: 'low drone', visuals: 'dark' }],
      hook: [{ start: 0, end: 3, sound: 'sub drop' }],
      sync: [{ at: 12, motion: 'line draws', sound: 'tick' }],
    }),
    hook: stage({
      summary: 'A cold open.',
      rows: [
        { start: 0, end: 3, visual: 'Plane in a void', camera: 'push-in', onScreenText: 'BOXCAR' },
        { start: 3, end: 9, visual: 'Map', onScreenText: '' },
      ],
    }),
    design: stage({
      colourModes: [{ name: 'Void', hexes: ['0a0b0e', '#123456'], use: 'Most scenes' }],
      typography: [
        { role: 'Titles', style: 'Geometric sans', casing: 'ALL CAPS', examples: ['BOXCAR'] },
      ],
      motion: [{ name: 'Scramble reveal', description: 'Letters lock in', at: ['0:12'] }],
    }),
    archetypes: stage({
      items: [
        {
          name: 'Timeline grid',
          description: 'Beam over a grid',
          keyframe: 'k-001',
          at: [5],
          buildWith: 'code',
        },
        {
          name: 'Unknown',
          description: 'Not a real frame',
          keyframe: 'k-099',
          at: [],
          buildWith: 'ai image',
        },
      ],
    }),
    motion: stage({
      items: [
        {
          name: 'Line draws outward',
          kind: 'graphic',
          strips: ['s-001', 's-009'],
          at: [12],
          easing: 'ease-out',
          rebuild: { method: 'code', recipe: 'Animate stroke-dashoffset over 15 frames.' },
        },
      ],
    }),
    techniques: stage({
      items: [
        {
          name: 'Hammer drop',
          description: 'Short line after a long one',
          quotes: [
            { text: 'One person', at: 2 },
            { text: 'Made up words', at: 3 },
          ],
        },
      ],
    }),
    sound: stage({
      voice: 'Close mic',
      music: 'Dark pulse',
      sfx: [{ cue: 'Tick', description: 'On reveals', at: [12] }],
      mix: 'Voice on top',
    }),
    plan: { problem: 'The plan could not be written: limit.' },
  },
};

describe('stage answers', () => {
  test('times may be seconds or clock text', () => {
    expect(secondsOf('1:02:03')).toBe(3723);
    expect(secondsOf('[0:12]')).toBe(12);
    expect(secondsOf(-1)).toBeNull();
    expect(secondsOf('soon')).toBeNull();
    expect(secondsOf({})).toBeNull();
  });

  test('JSON is lifted from a bare answer, a fence or the outer braces', () => {
    expect(liftJson('{"a":1}')).toEqual({ a: 1 });
    expect(liftJson('Here:\n```json\n{"a":2}\n```')).toEqual({ a: 2 });
    expect(liftJson('Sure! {"a":3} hope it helps')).toEqual({ a: 3 });
    expect(liftJson('no json')).toBeNull();
  });

  test('a stage that fits is taken; one that does not is refused with where it went wrong', () => {
    const fine = checkStage('sound', JSON.stringify({ voice: 'v', music: 'm', sfx: [], mix: 'x' }));
    expect(fine.ok).toBe(true);
    expect(checkStage('sound', 'prose only')).toEqual({
      ok: false,
      reason: 'the answer held no JSON object',
    });
    const wrong = checkStage(
      'hook',
      JSON.stringify({ summary: 's', rows: [{ start: 'later', end: 2, visual: 'v' }] }),
    );
    expect(wrong.ok).toBe(false);
    expect(!wrong.ok && wrong.reason).toMatch(/rows\.0\.start/);
  });
});

describe('a stage that code repaired to keep', () => {
  const sound = { voice: 'v', music: 'm', sfx: [], mix: 'x' };
  const repaired = ['sfx 1, at: one entry could not be read, so it was left out.'];
  const input = {
    ...FULL_INPUT,
    stages: { ...FULL_INPUT.stages, sound: stage({ ...sound, repaired }) },
  };

  test('says what was shortened or left out, in the report and in the file', () => {
    const report = buildTeardownReport(input);

    expect(report.stages.sound).toMatchObject({ state: 'done', data: sound, repaired });
    expect(teardownMarkdown(report)).toContain(
      `To keep it, code shortened or left out: ${repaired[0]}`,
    );
  });

  test('says nothing of repairs for a stage that fitted as written', () => {
    const report = buildTeardownReport(FULL_INPUT);

    expect(report.stages.structure.state === 'done' && report.stages.structure.repaired).toBe(
      undefined,
    );
  });
});

describe('buildTeardownReport', () => {
  test('adds what code knows to what the engines judged', () => {
    const report = buildTeardownReport(FULL_INPUT);
    expect(report.chapters.from).toBe('engine');
    expect(report.chapters.items[0]).toMatchObject({
      title: 'Hook',
      start: 0,
      end: 60,
      cutsPerMinute: 3,
      wordsPerMinute: 7,
      animations: 1,
      motionIntensity: 1.5,
      sheet: 'chapter-01.jpg',
    });
    expect(report.chapters.items[1]).toMatchObject({ transitions: 1, sheet: null });
    expect(report.hookRows).toEqual([
      expect.objectContaining({
        narration: 'This is how it starts. One person.',
        sound: 'sub drop',
        soundFrom: 'heard',
      }),
      expect.objectContaining({
        narration: '',
        sound: 'quiet dip 0:04–0:05; peak -3 dBFS at 0:08',
        soundFrom: 'measured',
        camera: '',
      }),
    ]);
    expect(report.colourModes[0]).toMatchObject({ hexes: ['#0A0B0E'], unmeasured: ['#123456'] });
    expect(report.archetypes.map((item) => item.image)).toEqual(['k-001.jpg', null]);
    expect(report.techniques[0]?.quotes.map((quote) => quote.found)).toEqual([true, false]);
    expect(report.animations[0]?.shown.map((strip) => strip.id)).toEqual(['s-001']);
    expect(report.soundHeard).toBe(true);
    expect(report.stages.plan).toEqual({
      state: 'failed',
      reason: 'The plan could not be written: limit.',
    });
    expect(report.transcript.words?.wordCount).toBe(11);
  });

  test('with nothing judged, the video is cut evenly and every stage says it is missing', () => {
    const report = buildTeardownReport({
      videoId: VIDEO,
      about: null,
      measured: MEASURED,
      measuredProblem: null,
      transcript: null,
      sheets: {},
      stages: { hook: { engine: 'claude', json: '{bad' } },
    });
    expect(report.chapters.from).toBe('even');
    expect(report.chapters.items).toHaveLength(2);
    expect(report.chapters.items[0]?.wordsPerMinute).toBeNull();
    expect(report.stages.structure.state).toBe('missing');
    expect(report.stages.hook).toEqual({
      state: 'failed',
      reason: 'What was stored could not be read back.',
    });
    expect(report.hookRows).toEqual([]);
    expect(report.soundHeard).toBe(false);
    expect(buildTeardownReport({ ...FULL_INPUT, measured: null }).chapters.items).toEqual([]);
  });
});

describe('teardownMarkdown', () => {
  test('lays the teardown out in eight sections with tables, pictures and prompts', () => {
    const plan = {
      layers: [{ layer: 'HUD', toolType: 'code-animated motion graphics', produces: 'overlays' }],
      components: [{ name: 'TimelineGrid', archetype: 'Timeline grid', buildWith: 'code' }],
      workflow: ['Write the script'],
      prompts: {
        script: 'Write about [TOPIC]',
        visuals: [{ archetype: 'Timeline grid', prompt: 'A grid [SCENE]' }],
        thumbnail: 'A thumbnail [SUBJECT]',
      },
      avoid: ['Their exact logo'],
    };
    const text = teardownMarkdown(
      buildTeardownReport({ ...FULL_INPUT, stages: { ...FULL_INPUT.stages, plan: stage(plan) } }),
    );
    for (const heading of [
      '## 1.',
      '## 2.',
      '## 3.',
      '## 4.',
      '## 5.',
      '## 6.',
      '## 7.',
      '## 8.',
    ]) {
      expect(text).toContain(heading);
    }
    expect(text).toContain('| Shot pacing | 5 cuts, median shot 15 s');
    expect(text).toContain('![k-001.jpg](images/k-001.jpg)');
    expect(text).toContain('![hook.jpg](images/hook.jpg)');
    expect(text).toContain('![s-001.jpg](images/s-001.jpg)');
    expect(text).toContain('`#0A0B0E` | 70%');
    expect(text).toContain('named but not measured, left out: #123456');
    expect(text).toContain('**Mix target (measured from this video):** -16 LUFS integrated.');
    expect(text).toContain('```text\nWrite about [TOPIC]\n```');
    expect(text).toContain('(not found word for word in the transcript)');
    expect(text).toContain('0:12 line draws ↔ tick');
  });

  test('says plainly what was not measured, heard or made', () => {
    const text = teardownMarkdown(
      buildTeardownReport({
        videoId: VIDEO,
        about: null,
        measured: null,
        measuredProblem: 'ffmpeg is not installed',
        transcript: null,
        sheets: {},
        stages: {},
      }),
    );
    expect(text).toContain('# Production teardown & style bible: Video abcdefghijk');
    expect(text).toContain('_Nothing was measured: ffmpeg is not installed_');
    expect(text).toContain('The sound was not heard by any engine');
    expect(text).toContain('_The frames could not be gone through one by one._');
  });
});

describe('zipFiles', () => {
  test('stores each file whole under its name, readable back', () => {
    const zip = zipFiles([
      { name: 'teardown.md', bytes: Buffer.from('# Hi') },
      { name: 'images/k-001.jpg', bytes: Uint8Array.from([0xff, 0xd8, 1]) },
    ]);
    expect(zip.readUInt32LE(0)).toBe(0x04034b50);
    const nameLength = zip.readUInt16LE(26);
    expect(zip.subarray(30, 30 + nameLength).toString()).toBe('teardown.md');
    expect(zip.subarray(30 + nameLength, 34 + nameLength).toString()).toBe('# Hi');
    expect(zip.readUInt32LE(zip.length - 22)).toBe(0x06054b50);
    expect(zip.readUInt16LE(zip.length - 12)).toBe(2);
    expect(() => zipFiles([{ name: '../x', bytes: new Uint8Array() }])).toThrow(/safe/);
    expect(inflateRawSync).toBeTypeOf('function');
  });
});

describe('SqliteTeardownRepo', () => {
  test('keeps one row per video and part, replaced by a new save, listed newest first', () => {
    const db = openDatabase(':memory:');
    migrate(db);
    const repo = new SqliteTeardownRepo(db);
    const at = new Date('2026-11-22T10:00:00Z');
    repo.save(VIDEO, 'measured', { engine: 'jgtube', json: '{"a":1}' }, at);
    repo.save(VIDEO, 'hook', { problem: 'limit' }, at);
    repo.save(
      'bbbbbbbbbbb',
      'plan',
      { engine: 'codex', json: '{}' },
      new Date('2026-11-22T11:00:00Z'),
    );
    expect(repo.find(VIDEO, 'hook')).toMatchObject({ json: null, problem: 'limit', engine: null });
    repo.save(VIDEO, 'hook', { engine: 'claude', json: '{"rows":[]}' }, at);
    expect(repo.find(VIDEO, 'hook')).toMatchObject({
      json: '{"rows":[]}',
      problem: null,
      engine: 'claude',
    });
    expect(repo.parts(VIDEO).map((part) => part.part)).toEqual(['hook', 'measured']);
    expect(repo.videos().map((video) => video.videoId)).toEqual(['bbbbbbbbbbb', VIDEO]);
    expect(repo.find(VIDEO, 'plan')).toBeNull();
    expect(() => repo.save('bad', 'hook', { problem: 'x' }, at)).toThrow(/video id/);
    expect(() => repo.save(VIDEO, 'nope' as 'hook', { problem: 'x' }, at)).toThrow(/part/);
    expect(() => repo.save(VIDEO, 'hook', { engine: ' ', json: '{}' }, at)).toThrow(/who made/);
    expect(() => repo.save(VIDEO, 'hook', { engine: 'x', json: ' ' }, at)).toThrow(/JSON/);
    repo.remove(VIDEO);
    expect(repo.parts(VIDEO)).toEqual([]);
    db.close();
  });
});

describe('teardown folder', () => {
  test('pictures are read by name only, and only real JPEGs of ours', async () => {
    const folder = teardownFolder(root, VIDEO);
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, 'k-001.jpg'), Buffer.from([0xff, 0xd8, 9]));
    writeFileSync(join(folder, 'hook.jpg'), Buffer.from('not a picture'));
    writeFileSync(join(folder, 'notes.txt'), 'x');
    expect(await readTeardownImage(root, VIDEO, 'k-001.jpg')).toEqual(
      Uint8Array.from([0xff, 0xd8, 9]),
    );
    expect(await readTeardownImage(root, VIDEO, 'hook.jpg')).toBeNull();
    expect(await readTeardownImage(root, VIDEO, '../x.jpg')).toBeNull();
    expect(await readTeardownImage(root, VIDEO, 's-001.jpg')).toBeNull();
    expect(await teardownImages(root, VIDEO)).toEqual(['hook.jpg', 'k-001.jpg']);
    expect(await teardownImages(root, 'zzzzzzzzzzz')).toEqual([]);
    expect(() => teardownFolder(root, '../../etc')).toThrow();
    expect(chapterSheetFile(3)).toBe('chapter-03.jpg');
  });

  test('chapter sheets: none without ffmpeg; one per chapter with it', async () => {
    const empty = mkdtempSync(join(root, 'bin-'));
    expect(
      await cutChapterSheets('/a.mp4', root, [{ start: 0, end: 5 }], { env: { PATH: empty } }),
    ).toEqual({});
    const ffmpeg = await findProgram('ffmpeg');
    if (ffmpeg === null) return;
    const clip = join(root, 'clip.mp4');
    execFileSync(ffmpeg, [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc=duration=10:size=320x180:rate=10',
      clip,
    ]);
    const folder = join(root, 'sheets');
    mkdirSync(folder);
    const made = await cutChapterSheets(clip, folder, [
      { start: 0, end: 5 },
      { start: 5, end: 10 },
    ]);
    expect(made).toEqual({ '1': 'chapter-01.jpg', '2': 'chapter-02.jpg' });
  }, 30_000);
});
