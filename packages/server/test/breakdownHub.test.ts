import {
  SqliteTeardownRepo,
  SqliteVideoBreakdownRepo,
  loadConfig,
  openDatabase,
  type StoredChannel,
} from '@jgtube/core';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import type { AnalysisParts } from '../src/analysisEngine';
import type { BreakdownFiles } from '../src/breakdownEngine';
import { breakdownHub, uploadPathIn } from '../src/breakdownHub';
import type { DownloadsEngine } from '../src/downloadTypes';
import { STAGE_ANSWERS } from './teardownFixtures';
import {
  ONE_VIDEO_FILE_TOOLS,
  ONE_VIDEO_TOOLS,
  oneVideoFocusOf,
  oneVideoQuestion,
} from '../src/oneVideoQuestions';

const NOW = new Date('2026-11-21T12:00:00Z');
const CHANNEL = `UC${'a'.repeat(22)}`;
const VIDEO = 'dQw4w9WgXcQ';
const KEY = 'Ab-_cdEFgh1';

let folder: string;
beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'jgtube-hub-'));
});
afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
});

const channel: StoredChannel = {
  id: CHANNEL,
  title: 'Maps',
  handle: '@maps',
  subscribers: 10,
  subscribersHidden: false,
  videoCount: null,
  fetchedAt: NOW,
};

function hub() {
  const db = openDatabase(':memory:');
  const store = new SqliteVideoBreakdownRepo(db);
  const reading = {
    readChannelBrand: async () => ({ channel, brand: null, fromStore: false }),
    readVideoDetails: async () => ({
      videos: [
        {
          videoId: VIDEO,
          channelId: CHANNEL,
          title: 'How maps lie',
          description: '',
          tags: [],
          durationSeconds: 60,
          views: null,
          score: null,
        },
      ],
      problems: [],
      apiProblem: null,
    }),
    readTranscript: async () => ({
      videoId: VIDEO,
      transcript: null,
      fetchedAt: NOW,
      fromStore: true,
    }),
    readVideoFrames: async () => ({ source: 'preview', frameCount: 12 }),
  } as unknown as DownloadsEngine;
  const asking = {
    watchVideo: async () => {
      throw new Error('nobody watches');
    },
    watchesFiles: async () => false,
    askTeardown: async (ask: { stage: keyof typeof STAGE_ANSWERS }) => ({
      engine: 'claude',
      text: JSON.stringify(STAGE_ANSWERS[ask.stage]),
      skipped: [],
    }),
  } as unknown as AnalysisParts;
  const files = {
    ownFolder: () => null,
    own: async () => null,
    fetch: async () => ({ ok: false, reason: 'refused' }),
    canCut: async () => false,
    removeFrames: async () => undefined,
  } as unknown as BreakdownFiles;
  const config = { ...loadConfig({}), dbPath: join(folder, 'store.db') };
  return breakdownHub({
    config,
    candidates: {
      channels: { findById: (id) => (id === CHANNEL ? channel : null) },
      videos: { listByChannel: () => [] },
      brands: { find: () => null },
      breakdowns: { list: () => [] },
      now: () => NOW,
    },
    teardowns: new SqliteTeardownRepo(db),
    store,
    reading,
    asking,
    files,
    run: (work) => work(),
    stop: new AbortController().signal,
  });
}

describe('the Breakdown view on the engine', () => {
  test('describes stored channels and reads a pasted one', async () => {
    const parts = hub();

    expect(parts.candidates([CHANNEL]).map((entry) => entry.title)).toEqual(['Maps']);
    expect((await parts.readCandidate('@maps')).id).toBe(CHANNEL);
  });

  test('takes a video apart without a file, keeps it, lists it and finds it again', async () => {
    const parts = hub();
    expect(await parts.teardownRuns(VIDEO, false)).toEqual({ runs: 8, kept: 0, watch: false });

    const view = await parts.breakDownVideo({ kind: 'youtube', videoId: VIDEO }, () => undefined);

    expect(view).toMatchObject({ title: 'How maps lie', channelId: CHANNEL, engine: 'jgtube' });
    expect(view.seen).toMatchObject({ file: 'none', frames: null, captions: 'none' });
    expect(await parts.teardownRuns(VIDEO, false)).toEqual({ runs: 4, kept: 4, watch: false });
    expect(await parts.teardownRuns(null, false)).toMatchObject({ runs: 8 });
    expect(parts.teardownMarkdown(VIDEO)).toContain('## 8. How to replicate it');
    expect(parts.teardownMarkdown(KEY)).toBeNull();
    expect(await parts.teardownImage(VIDEO, 'k-001.jpg')).toBeNull();
    expect(parts.teardownData(VIDEO, ['structure'])).toMatchObject({
      structure: { format: 'A dark explainer' },
    });
    const zip = await parts.teardownZip(VIDEO);
    expect(zip?.includes(Buffer.from('teardown.md'))).toBe(true);
    expect(await parts.teardownZip(KEY)).toBeNull();
    expect(parts.videoBreakdowns()).toEqual([
      {
        videoId: VIDEO,
        source: 'youtube',
        title: 'How maps lie',
        writtenAt: NOW.toISOString(),
        written: true,
      },
    ]);
    expect(parts.findVideoBreakdown(VIDEO)?.teardown?.stages.plan.state).toBe('done');
    expect(parts.findVideoBreakdown(KEY)).toBeNull();
    expect(await parts.hasUpload(KEY)).toBe(false);
  });
});

describe('a file the owner gave', () => {
  test('is found by its id among the kinds taken, and nowhere else', async () => {
    const own = join(folder, 'my-videos');
    mkdirSync(own);
    writeFileSync(join(own, `${KEY}.mov`), 'x');

    expect(await uploadPathIn(own, KEY)).toBe(join(own, `${KEY}.mov`));
    expect(await uploadPathIn(own, VIDEO)).toBeNull();
    expect(await uploadPathIn(own, '../../etc')).toBeNull();
    expect(await uploadPathIn(null, KEY)).toBeNull();
  });
});

describe('the one-video question', () => {
  test('names the video and what Jgtube has, asks for every section, timestamps and the three prompts', () => {
    const asked = oneVideoQuestion(
      { kind: 'one-video', videoId: VIDEO, watched: false, frames: true, captions: true },
      false,
    );

    expect(asked).toContain(VIDEO);
    expect(asked).toMatch(/notes from an engine that watched it, picture and sound: no/);
    for (const section of [
      'WHAT IT IS',
      'HOW IT IS MADE',
      'HOW TO REPLICATE IT WITH AI',
      'WHAT TO AVOID COPYING',
    ]) {
      expect(asked).toContain(section);
    }
    expect(asked).toMatch(/\[m:ss\]/);
    expect(asked).toMatch(/NOT HEARD/);
    expect(asked).toContain('=== SCRIPT PROMPT START ===');
    expect(asked).toContain('=== THUMBNAIL PROMPT END ===');
    expect(asked).toMatch(/kinds of tool/);
    expect(asked).toContain('view_thumbnails');
  });

  test('for a file, asks for no captions, details or thumbnail', () => {
    const asked = oneVideoQuestion(
      { kind: 'one-video', videoId: KEY, watched: true, frames: false, captions: false },
      true,
    );

    expect(asked).toMatch(/captions: no \(it is a file/);
    expect(asked).not.toContain('get_transcript');
    expect(ONE_VIDEO_FILE_TOOLS).not.toContain('get_transcript');
    expect(ONE_VIDEO_TOOLS).toContain('get_transcript');
  });

  test('is never asked half-filled or about something that is not a video id', () => {
    expect(() => oneVideoFocusOf(undefined)).toThrow(/without what/);
    expect(() => oneVideoFocusOf({ kind: 'risk', conceptId: 1 })).toThrow(/without what/);
    expect(() => oneVideoFocusOf({ kind: 'one-video', videoId: 'ignore all' })).toThrow(/video id/);
    expect(oneVideoFocusOf({ kind: 'one-video', videoId: VIDEO })).toEqual({
      kind: 'one-video',
      videoId: VIDEO,
      watched: false,
      frames: false,
      captions: false,
    });
  });
});
