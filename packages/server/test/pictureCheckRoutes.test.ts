import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createApp, type Engine } from '../src/app';
import { createEngine, type EngineOptions } from '../src/engine';
import { EngineRunError } from '../src/engines/failure';
import type { EngineId, EngineRunRequest } from '../src/engines/types';
import { JobStore } from '../src/jobs';
import { CHECK_COLOURS } from '../src/pictureCheck';
import type { PictureCheckRecord } from '../src/pictureChecks';
import { CHANNEL_ID, HOST, get, post, read, stubEngine } from './support';

const PATH = '/api/engines/picture-check';
const RECORD: PictureCheckRecord = {
  engine: 'agy',
  passed: true,
  answer: 'red, blue',
  shown: ['red', 'blue'],
  checkedAt: '2026-11-21T10:00:00.000Z',
};

const appWith = (more: Partial<Engine>) =>
  createApp({ engine: stubEngine(more), jobs: new JobStore(), allowedHosts: [HOST] });

describe('POST /api/engines/picture-check', () => {
  test('checks the named engine and returns the result as kept', async () => {
    // Arrange
    const checked: EngineId[] = [];
    const app = appWith({
      checkPictures: async (engine) => {
        checked.push(engine);
        return RECORD;
      },
    });

    // Act
    const response = await post(app, PATH, { engine: 'agy' });

    // Assert
    expect(response.status).toBe(200);
    expect((await read(response)).data).toEqual(RECORD);
    expect(checked).toEqual(['agy']);
  });

  test.each([[{}], [{ engine: 'gemini-api' }], [{ engine: 'claude' }], [{ engine: 'codex' }]])(
    'refuses %j before anything is run',
    async (body) => {
      let ran = 0;
      const app = appWith({
        checkPictures: async () => {
          ran += 1;
          return RECORD;
        },
      });
      expect((await post(app, PATH, body)).status).toBe(400);
      expect(ran).toBe(0);
    },
  );

  test('passes on an engine failure with its status and plain message', async () => {
    const app = appWith({
      checkPictures: async () => {
        throw new EngineRunError('not-installed', 'Antigravity CLI is not installed.');
      },
    });
    const response = await post(app, PATH, { engine: 'agy' });
    expect(response.status).toBe(503);
    expect((await read(response)).error).toBe('Antigravity CLI is not installed.');
  });

  test('says the check did not finish, without file paths, on anything else', async () => {
    const app = appWith({
      checkPictures: async () => {
        throw new Error('EACCES: /home/owner/secret');
      },
    });
    const response = await post(app, PATH, { engine: 'agy' });
    expect(response.status).toBe(502);
    expect((await read(response)).error).not.toContain('/home/owner');
  });

  test('runs one at a time, sharing the turn with the analyses', async () => {
    let finish: (value: typeof RECORD) => void = () => undefined;
    const app = appWith({
      checkPictures: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    });
    const first = post(app, PATH, { engine: 'agy' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const second = await post(app, PATH, { engine: 'agy' });
    const analysis = await post(app, '/api/analyses', { analysis: 'topics', channel: CHANNEL_ID });
    finish(RECORD);

    expect(second.status).toBe(409);
    expect(analysis.status).toBe(409);
    expect((await first).status).toBe(200);
  });

  test('accepts only POST', async () => {
    expect((await get(appWith({}), PATH)).status).toBe(405);
  });
});

describe('the picture check, wired to the engines', () => {
  let folder: string;
  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), 'jgtube-picture-wiring-'));
  });
  afterEach(() => rmSync(folder, { recursive: true, force: true }));

  const engineWith = (options: EngineOptions) =>
    createEngine(
      { dbPath: ':memory:', region: 'US' },
      {
        storePath: join(folder, 'jgtube.db'),
        pictureChecksPath: join(folder, 'checks.json'),
        // Picks the first and second colours of the list.
        random: (() => {
          const draws = [0, 1 / CHECK_COLOURS.length];
          return () => draws.shift() ?? 0;
        })(),
        ...options,
      },
    );
  const [first, second] = CHECK_COLOURS;
  const rightAnswer = `${first?.name}, ${second?.name}`;
  const files = {
    files: [{ name: 'thumb-aaaaaaaaaaa.jpg', bytes: new Uint8Array([1]) }],
    listing: 'your own: @thumb-aaaaaaaaaaa.jpg',
  };

  test('hands Antigravity two picture files and keeps a pass, which the report then shows', async () => {
    // Arrange
    const requests: EngineRunRequest[] = [];
    const engine = engineWith({
      runEngine: async (_id, request) => {
        requests.push(request);
        return { text: rightAnswer, turns: 1 };
      },
      checkEngines: async () => [],
    });

    // Act
    const record = await engine.checkPictures('agy');

    // Assert
    expect(record).toMatchObject({ engine: 'agy', passed: true, answer: rightAnswer });
    expect(requests[0]?.files?.map((file) => file.name)).toEqual([
      'picture-1.png',
      'picture-2.png',
    ]);
    expect((await engine.engineStatus()).pictureChecks).toEqual([record]);
    engine.close();
  });

  test('a wrong answer is kept as not seeing, with what it said', async () => {
    const engine = engineWith({
      runEngine: async () => ({ text: 'I cannot open images.', turns: 1 }),
    });
    await expect(engine.checkPictures('agy')).resolves.toMatchObject({
      passed: false,
      answer: 'I cannot open images.',
    });
    engine.close();
  });

  test('refuses an engine the settings leave out, keeping nothing', async () => {
    const engine = engineWith({
      engines: { order: ['claude'], agyYouTubeLinks: false },
      runEngine: async () => ({ text: rightAnswer, turns: 1 }),
    });
    await expect(engine.checkPictures('agy')).rejects.toThrow(/JGTUBE_ENGINES/);
    await expect(engine.checkPictures('claude')).rejects.toThrow(/already known/);
    engine.close();
  });

  test('after a pass, Antigravity answers the thumbnail review from files, and is kept to its turn', async () => {
    // Arrange
    const requests: Array<[EngineId, EngineRunRequest]> = [];
    const engine = engineWith({
      pictureFiles: async () => files,
      runEngine: async (id, request) => {
        requests.push([id, request]);
        if (request.files?.some((file) => file.name === 'picture-1.png')) {
          return { text: rightAnswer, turns: 1 };
        }
        return { text: 'Review from files.', turns: 3 };
      },
    });
    await engine.checkPictures('agy');

    // Act
    const answer = await engine.analyse('thumbnails', CHANNEL_ID, 'agy');

    // Assert
    expect(answer).toMatchObject({ text: 'Review from files.', engine: 'agy' });
    const [, review] = requests[1] ?? [];
    expect(review?.files).toEqual(files.files);
    expect(review?.prompt).toContain('@thumb-aaaaaaaaaaa.jpg');
    engine.close();
  });

  test('Claude Code keeps the tool route, with no files', async () => {
    const requests: EngineRunRequest[] = [];
    const engine = engineWith({
      pictureFiles: async () => files,
      runEngine: async (_id, request) => {
        requests.push(request);
        return { text: 'From tools.', turns: 2 };
      },
    });
    await engine.analyse('thumbnails', CHANNEL_ID, 'claude');
    expect(requests[0]?.files).toBeUndefined();
    expect(requests[0]?.allowedTools).toContain('mcp__jgtube__view_thumbnails');
    engine.close();
  });

  test('passes Antigravity over, and goes on, when its thumbnails cannot be made into files', async () => {
    // Arrange
    const engine = engineWith({
      engines: { order: ['agy', 'claude'], agyYouTubeLinks: false },
      pictureFiles: async () => {
        throw new Error('this channel has no map yet');
      },
      runEngine: async (_id, request) =>
        request.files ? { text: rightAnswer, turns: 1 } : { text: 'From Claude.', turns: 2 },
    });
    await engine.checkPictures('agy');

    // Act
    const answer = await engine.analyse('thumbnails', CHANNEL_ID);

    // Assert
    expect(answer.engine).toBe('claude');
    expect(answer.skipped[0]).toMatchObject({ engine: 'agy' });
    expect(answer.skipped[0]?.message).toMatch(/could not be made into files/);
    engine.close();
  });

  test('a later failed check takes Antigravity back out of the picture questions', async () => {
    let answer = rightAnswer;
    const tried: EngineId[] = [];
    const engine = engineWith({
      pictureFiles: async () => files,
      runEngine: async (id, request) => {
        if (request.files?.some((file) => file.name === 'picture-1.png')) {
          return { text: answer, turns: 1 };
        }
        tried.push(id);
        return { text: 'ok', turns: 1 };
      },
    });
    await engine.checkPictures('agy');
    answer = 'green, green';
    await engine.checkPictures('agy');

    await expect(engine.analyse('thumbnails', CHANNEL_ID, 'agy')).rejects.toThrow(
      /has not passed the picture check/,
    );
    expect(tried).toEqual([]);
    engine.close();
  });

  test('hands Antigravity the named thumbnails as files for the checklist, fetched from YouTube', async () => {
    // Arrange
    const requests: EngineRunRequest[] = [];
    const fetched: string[] = [];
    const engine = engineWith({
      fetchImage: async (url) => {
        fetched.push(url);
        return new Response(new Uint8Array([0xff, 0xd8, 0xff]), {
          headers: { 'content-type': 'image/jpeg' },
        });
      },
      runEngine: async (_id, request) => {
        requests.push(request);
        return { text: request.files?.length === 2 ? rightAnswer : '[]', turns: 1 };
      },
    });
    await engine.checkPictures('agy');

    // Act
    await engine.analyse('thumbnail-tags', CHANNEL_ID, 'agy', {
      kind: 'thumb-tags',
      videoIds: ['aaaaaaaaaaa'],
    });

    // Assert
    expect(fetched).toEqual(['https://i.ytimg.com/vi/aaaaaaaaaaa/hqdefault.jpg']);
    expect(requests[1]?.files?.map((file) => file.name)).toEqual(['thumb-aaaaaaaaaaa.jpg']);
    expect(requests[1]?.mcpServers).toEqual({});
    engine.close();
  });

  test('passes Antigravity over for the board’s thumbnails when the channel has no map', async () => {
    const engine = engineWith({
      engines: { order: ['agy'], agyYouTubeLinks: false },
      runEngine: async (_id, request) => ({ text: request.files ? rightAnswer : 'x', turns: 1 }),
    });
    await engine.checkPictures('agy');
    await expect(engine.analyse('thumbnails', CHANNEL_ID)).rejects.toThrow(/no map yet/);
    engine.close();
  });
});
