import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createApp, type Engine } from '../src/app';
import { loadConfig } from '@jgtube/core';
import { analysisEngines } from '../src/analysisEngine';
import type { EngineId, EngineRunRequest } from '../src/engines/types';
import { JobStore } from '../src/jobs';
import { picturesFor, plannedRuns } from '../src/teardownEngine';
import { stageQuestion, watchQuestion } from '../src/teardownQuestions';
import { filesLook, teardownRequest, toolLook } from '../src/teardownRequests';
import { HOST, UNUSED_HUB, get, stubEngine } from './support';
import { MEASURED } from './teardownFixtures';

const VIDEO = 'dQw4w9WgXcQ';
let folder: string;
beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'jgtube-teardown-wiring-'));
});
afterEach(() => rmSync(folder, { recursive: true, force: true }));

const settings = () => ({
  projectRoot: '/jgtube',
  dbPath: '/data/jgtube.db',
  workDir: folder,
  downloadsPath: '/data/downloads',
});

describe('teardown questions', () => {
  test('every judged stage names only the video id and asks for its JSON shape through the data tool', () => {
    for (const stage of [
      'structure',
      'hook',
      'design',
      'archetypes',
      'motion',
      'techniques',
      'sound',
      'plan',
    ] as const) {
      const asked = stageQuestion(stage, {
        videoId: VIDEO,
        look: '',
        heard: false,
        chapterCount: 2,
      });
      expect(asked).toContain(`get_video_teardown with video "${VIDEO}"`);
      expect(asked).toMatch(/Answer in this JSON shape: \{/);
    }
    expect(
      stageQuestion('sound', { videoId: VIDEO, look: '', heard: false, chapterCount: 0 }),
    ).toMatch(/No engine heard/);
    expect(
      stageQuestion('sound', { videoId: VIDEO, look: '', heard: true, chapterCount: 0 }),
    ).toMatch(/"watch" part/);
  });

  test('the watch question goes chapter by chapter and asks for words only without captions', () => {
    expect(watchQuestion([{ start: 0, end: 20.4 }], true)).toMatch(
      /0–20 s.*Write down every spoken line/,
    );
    expect(watchQuestion([], false)).toMatch(/natural parts.*Leave "transcript" empty/);
  });

  test('looks are written in calls of eight, or as files', () => {
    const names = Array.from(
      { length: 10 },
      (_, index) => `k-${String(index + 1).padStart(3, '0')}.jpg`,
    );
    expect(toolLook(VIDEO, names)).toMatch(/in 2 calls/);
    expect(toolLook(VIDEO, ['hook.jpg'])).toMatch(/in 1 call with/);
    expect(filesLook(['hook.jpg'])).toContain('@hook.jpg');
  });
});

describe('teardown requests', () => {
  test('Claude Code sees pictures through the picture tool; Antigravity gets them as files; text stages get the data tool only', async () => {
    const picture = join(folder, 'hook.jpg');
    writeFileSync(picture, Buffer.from([0xff, 0xd8, 1]));
    const ask = {
      stage: 'hook' as const,
      videoId: VIDEO,
      heard: false,
      chapterCount: 1,
      pictures: [{ name: 'hook.jpg', path: picture }],
    };

    const claude = await teardownRequest(ask, 'claude', settings());
    expect(claude.allowedTools).toEqual([
      'mcp__jgtube__get_video_teardown',
      'mcp__jgtube__view_teardown_images',
    ]);
    expect(claude.mcpServers['jgtube']?.env?.['JGTUBE_TOOLS']).toBe(
      'get_video_teardown,view_teardown_images',
    );
    expect(claude.files).toBeUndefined();
    expect(claude.prompt).toContain('view_teardown_images');

    const agy = await teardownRequest(ask, 'agy', settings());
    expect(agy.allowedTools).toEqual(['mcp__jgtube__get_video_teardown']);
    expect(agy.files).toEqual([{ name: 'hook.jpg', bytes: Uint8Array.from([0xff, 0xd8, 1]) }]);
    expect(agy.prompt).toContain('@hook.jpg');

    const text = await teardownRequest(
      { ...ask, stage: 'plan', pictures: [] },
      'codex',
      settings(),
    );
    expect(text.allowedTools).toEqual(['mcp__jgtube__get_video_teardown']);
    expect(text.maxTurns).toBe(8);
  });

  test('pictures are chosen and capped in code for each stage', () => {
    expect(picturesFor('hook', null, {}, folder)).toEqual([]);
    expect(picturesFor('hook', MEASURED, {}, folder).map((p) => p.name)).toEqual([
      'hook.jpg',
      'k-001.jpg',
    ]);
    expect(picturesFor('design', MEASURED, {}, folder).map((p) => p.name)).toEqual([
      'k-001.jpg',
      'k-002.jpg',
    ]);
    expect(picturesFor('archetypes', MEASURED, {}, folder)).toHaveLength(2);
    expect(picturesFor('motion', MEASURED, {}, folder).map((p) => p.path)).toEqual([
      join(folder, 's-001.jpg'),
    ]);
    expect(picturesFor('plan', MEASURED, {}, folder)).toEqual([]);
    const many = {
      ...MEASURED,
      keyframes: Array.from({ length: 40 }, (_, i) => ({
        id: `k-${String(i + 1).padStart(3, '0')}`,
        at: 50 + i,
        shot: i,
        covers: 1,
        file: `k-${String(i + 1).padStart(3, '0')}.jpg`,
      })),
    };
    expect(picturesFor('archetypes', many, {}, folder)).toHaveLength(24);
  });

  test('the planned runs count a watch only when something watches files', async () => {
    const repo = { find: () => null } as never;
    expect(await plannedRuns({ repo, watchesFiles: async () => true }, VIDEO, false, true)).toEqual(
      { runs: 9, kept: 0, watch: true },
    );
    expect(
      await plannedRuns({ repo, watchesFiles: async () => true }, VIDEO, false, false),
    ).toEqual({ runs: 8, kept: 0, watch: false });
  });
});

describe('askTeardown on the real engine', () => {
  const parts = (order: readonly EngineId[], tried: Array<[EngineId, EngineRunRequest]>) =>
    analysisEngines(
      {
        config: {
          ...loadConfig({}),
          dbPath: join(folder, 'jgtube.db'),
          downloadsPath: join(folder, 'downloads'),
        },
        options: {
          storePath: join(folder, 'jgtube.db'),
          pictureChecksPath: join(folder, 'checks.json'),
          engines: { order, agyYouTubeLinks: false },
          runEngine: async (id, request) => {
            tried.push([id, request]);
            return { text: '{}', turns: 1 };
          },
        },
        work: { run: (work: () => unknown) => work() } as never,
      },
      new AbortController().signal,
    );

  test('a picture stage goes to Antigravity as files by default, and past it once it failed the check', async () => {
    const picture = join(folder, 'k-001.jpg');
    writeFileSync(picture, Buffer.from([0xff, 0xd8]));
    const tried: Array<[EngineId, EngineRunRequest]> = [];
    const asking = parts(['agy', 'codex', 'claude'], tried);
    const ask = {
      stage: 'archetypes' as const,
      videoId: VIDEO,
      heard: false,
      chapterCount: 0,
      pictures: [{ name: 'k-001.jpg', path: picture }],
    };

    await expect(asking.askTeardown(ask)).resolves.toMatchObject({ engine: 'agy', text: '{}' });
    expect(tried[0]?.[1].files?.map((file) => file.name)).toEqual(['k-001.jpg']);
    expect(tried[0]?.[1].prompt).toContain('@k-001.jpg');
    await expect(
      asking.askTeardown({ ...ask, stage: 'plan', pictures: [] }),
    ).resolves.toMatchObject({ engine: 'agy' });
    writeFileSync(
      join(folder, 'checks.json'),
      JSON.stringify({
        checks: [
          { engine: 'agy', passed: false, answer: 'x', shown: ['red', 'blue'], checkedAt: 'now' },
        ],
      }),
    );
    const afterCheck = parts(['agy', 'codex', 'claude'], tried);
    await expect(afterCheck.askTeardown(ask, 'agy')).resolves.toMatchObject({
      engine: 'codex',
      standInFor: {
        engine: 'agy',
        because: 'Antigravity CLI failed the picture check in Settings.',
      },
    });
    expect(tried.map(([id]) => id)).toEqual(['agy', 'agy', 'codex']);
    asking.cleanUp();
    afterCheck.cleanUp();
  });
});

describe('teardown routes', () => {
  const appWith = (hub: Partial<Engine['hub']>) =>
    createApp({
      engine: stubEngine({ hub: { ...UNUSED_HUB, ...hub } }),
      jobs: new JobStore(),
      allowedHosts: [HOST],
    });

  test('serves the run count, a picture, the Markdown and the ZIP, and refuses anything else', async () => {
    const app = appWith({
      teardownRuns: async () => ({ runs: 9, kept: 0, watch: true }),
      teardownImage: async (_id, name) =>
        name === 'k-001.jpg' ? Uint8Array.from([0xff, 0xd8]) : null,
      teardownMarkdown: (id) => (id === VIDEO ? '# Teardown' : null),
      teardownZip: async (id) => (id === VIDEO ? Buffer.from('PK') : null),
    });
    const runs = await get(app, `/api/video-teardowns/runs?video=${VIDEO}`);
    expect(await runs.json()).toMatchObject({ data: { runs: 9, kept: 0, watch: true } });
    expect((await get(app, '/api/video-teardowns/runs?video=bad')).status).toBe(400);
    const image = await get(app, `/api/video-teardowns/${VIDEO}/images/k-001.jpg`);
    expect(image.headers.get('content-type')).toBe('image/jpeg');
    expect((await get(app, `/api/video-teardowns/${VIDEO}/images/k-002.jpg`)).status).toBe(404);
    const md = await get(app, `/api/video-teardowns/${VIDEO}/teardown.md`);
    expect(md.headers.get('content-disposition')).toContain(`teardown-${VIDEO}.md`);
    expect(await md.text()).toBe('# Teardown');
    expect((await get(app, '/api/video-teardowns/aaaaaaaaaaa/teardown.md')).status).toBe(404);
    expect(
      (await get(app, `/api/video-teardowns/${VIDEO}/export.zip`)).headers.get('content-type'),
    ).toBe('application/zip');
    expect((await get(app, '/api/video-teardowns/aaaaaaaaaaa/export.zip')).status).toBe(404);
    expect((await get(app, `/api/video-teardowns/${VIDEO}/other.txt`)).status).toBe(404);
  });
});

describe('the downloads folder', () => {
  test('exists for the wiring test', () => {
    mkdirSync(join(folder, 'downloads'), { recursive: true });
    expect(folder).toBeTruthy();
  });
});
