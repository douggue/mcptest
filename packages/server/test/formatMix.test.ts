import { loadConfig } from '@jgtube/core';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { joinFiles } from '../src/analysisAsker';
import { analysisEngines } from '../src/analysisEngine';
import type { EngineId, EngineRunRequest } from '../src/engines/types';
import {
  MIX_SYSTEM_PROMPT,
  filesLook,
  mixQuestion,
  mixRequest,
  toolLook,
  type MixAsk,
} from '../src/formatMixRequests';

const CHANNEL = 'UCcccccccccccccccccccccc';
let folder: string;
beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'jgtube-format-mix-'));
});
afterEach(() => rmSync(folder, { recursive: true, force: true }));

const settings = () => ({
  projectRoot: '/jgtube',
  dbPath: '/data/jgtube.db',
  workDir: folder,
  downloadsPath: '/data/downloads',
});

const ask = (parts: Partial<MixAsk> = {}): MixAsk => ({
  formatId: 4,
  formatName: 'Long-form',
  channel: CHANNEL,
  pictures: [],
  thumbnails: [],
  ...parts,
});

describe('the mix question', () => {
  test('reads the shelf, the map when there is one, and asks for checked JSON with no forecasts', () => {
    const text = mixQuestion(ask(), '');
    expect(text).toContain('get_format_shelf with format 4');
    expect(text).toContain(`get_map and get_breakouts for the channel ${CHANNEL}`);
    expect(text).toContain('"ingredient": 12');
    expect(mixQuestion(ask({ channel: null }), '')).toContain('judge from the shelf alone');
    expect(MIX_SYSTEM_PROMPT).toMatch(/never forecast/);
  });

  test('a text run is allowed the shelf and map tools only', () => {
    const request = mixRequest(ask(), 'claude', settings());
    expect(request.allowedTools).toEqual([
      'mcp__jgtube__get_format_shelf',
      'mcp__jgtube__get_map',
      'mcp__jgtube__get_breakouts',
    ]);
    expect(request.files).toBeUndefined();
    expect(request.maxTurns).toBe(10);
    expect(mixRequest(ask({ channel: null }), 'codex', settings()).allowedTools).toEqual([
      'mcp__jgtube__get_format_shelf',
    ]);
  });

  test('the tool route looks through the picture tools in calls of eight', () => {
    const pictures = Array.from({ length: 9 }, (_, index) => ({
      name: `i${index + 1}-1.jpg`,
      path: '/x',
    }));
    const asked = ask({ pictures, thumbnails: ['aaaaaaaaaa1'] });
    const request = mixRequest(asked, 'claude', settings());
    expect(request.allowedTools).toContain('mcp__jgtube__view_format_pictures');
    expect(request.allowedTools).toContain('mcp__jgtube__view_thumbnails');
    expect(toolLook(asked)).toContain('"i8-1.jpg"], then ["i9-1.jpg"]');
    expect(toolLook(ask({ thumbnails: ['aaaaaaaaaa1'] }))).not.toContain('view_format_pictures');
    expect(request.maxTurns).toBe(16);
  });

  test('the files route hands the pictures over and names them in the question', () => {
    const files = {
      files: [{ name: 'i1-1.jpg', bytes: new Uint8Array([1]) }],
      listing: '@i1-1.jpg',
    };
    const asked = ask({ pictures: [{ name: 'i1-1.jpg', path: '/x' }] });
    const request = mixRequest(asked, 'agy', settings(), files);
    expect(request.files).toEqual(files.files);
    expect(request.prompt).toContain(filesLook(files));
    expect(request.allowedTools).not.toContain('mcp__jgtube__view_format_pictures');
  });
});

test('joinFiles keeps both sets of picture files, or the one there is', () => {
  const one = { files: [{ name: 'a', bytes: new Uint8Array() }], listing: 'A: @a' };
  const two = { files: [{ name: 'b', bytes: new Uint8Array() }], listing: 'B: @b' };
  const none = { files: [], listing: 'none' };
  expect(joinFiles(one, two)).toEqual({
    files: [...one.files, ...two.files],
    listing: 'A: @a; B: @b',
  });
  expect(joinFiles(one, null)).toBe(one);
  expect(joinFiles(none, two)).toBe(two);
});

describe('askFormatMix on the real engine', () => {
  const parts = (order: readonly EngineId[], tried: Array<[EngineId, EngineRunRequest]>) =>
    analysisEngines(
      {
        config: { ...loadConfig({}), dbPath: join(folder, 'jgtube.db') },
        options: {
          storePath: join(folder, 'jgtube.db'),
          pictureChecksPath: join(folder, 'checks.json'),
          engines: { order, agyYouTubeLinks: false },
          pictureFiles: async () => ({
            files: [{ name: 'aaaaaaaaaa1.jpg', bytes: new Uint8Array([1]) }],
            listing: 'thumbnails on the shelf: @aaaaaaaaaa1.jpg',
          }),
          runEngine: async (id, request) => {
            tried.push([id, request]);
            return { text: '{}', turns: 1 };
          },
        },
        work: { run: (work: () => unknown) => work() } as never,
      },
      new AbortController().signal,
    );

  test('pictures go to Antigravity as files; a text mix goes to the chosen engine', async () => {
    const picture = join(folder, 'k.jpg');
    writeFileSync(picture, Buffer.from([0xff, 0xd8]));
    const tried: Array<[EngineId, EngineRunRequest]> = [];
    const asking = parts(['agy', 'claude'], tried);
    const withPictures = ask({
      pictures: [{ name: 'i1-1.jpg', path: picture }],
      thumbnails: ['aaaaaaaaaa1'],
    });
    await expect(asking.askFormatMix(withPictures)).resolves.toMatchObject({ engine: 'agy' });
    expect(tried[0]?.[1].files?.map((file) => file.name)).toEqual(['i1-1.jpg', 'aaaaaaaaaa1.jpg']);
    await expect(asking.askFormatMix(withPictures, 'claude')).resolves.toMatchObject({
      engine: 'claude',
    });
    expect(tried[1]?.[1].files).toBeUndefined();
    await expect(asking.askFormatMix(ask(), 'claude')).resolves.toMatchObject({
      engine: 'claude',
    });
    await expect(
      asking.askFormatMix(ask({ thumbnails: [], pictures: [{ name: 'i1-1.jpg', path: picture }] })),
    ).resolves.toMatchObject({ engine: 'agy' });
    expect(tried.map(([id]) => id)).toEqual(['agy', 'claude', 'claude', 'agy']);
    asking.cleanUp();
  });
});
