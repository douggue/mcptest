import {
  EMPTY_SCRIPT,
  type StoredBatch,
  type StoredConcept,
  type StoredScript,
} from '@jgtube/core';
import type { ScriptForTool } from '@jgtube/server/src/scriptTypes';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { beforeEach, describe, expect, test } from 'vitest';
import { createToolHandlers, type ToolHandlers } from '../src/tools';
import { CENTER_ID, FakeEngine, textOf } from './fakes';

const AT = new Date('2026-11-21T09:00:00Z');
const A = 'aaaaaaaaaa1';
const MODEL = 'UCmmmmmmmmmmmmmmmmmmmmmm';

const batch: StoredBatch = {
  id: 7,
  centerChannelId: CENTER_ID,
  inspiration: [A],
  hookModels: [],
  format: null,
  angle: null,
  length: 'long',
  createdAt: AT,
};
const concept: StoredConcept = {
  id: 42,
  batchId: 7,
  centerChannelId: CENTER_ID,
  title: 'The Machine Nobody Switched Off',
  altTitles: ['Why It Still Runs', 'The Factory That Forgot'],
  thumbnail: 'A rusted press in an empty hall.',
  overlay: 'STILL RUNNING',
  hook: 'Nobody switched it off.',
  hookStyle: null,
  restsOn: `${A}: the cold open.`,
  needs: 'The year it closed.',
  origin: 'batch',
  parentId: null,
  engine: 'claude',
  kept: true,
  createdAt: AT,
};
const script: StoredScript = {
  ...EMPTY_SCRIPT,
  conceptId: 42,
  centerChannelId: CENTER_ID,
  status: 'drafting',
  voiceChannelId: MODEL,
  wordsPerMinute: 152,
  targetSeconds: 600,
  targetGrade: 6.4321,
  hookModels: [A],
  chosenHook: 'It never stopped.',
  beats: '1:00 | The bill | Who has been paying',
  draft: '## HOOK\nIt never stopped [CHECK: that it still runs].',
  tightened: '## HOOK\nIt never stopped.',
  updatedAt: AT,
};
const found = (overrides: Partial<ScriptForTool> = {}): ScriptForTool => ({
  concept,
  batch,
  picked: [
    {
      videoId: A,
      title: 'Title of A',
      channelId: 'UCaaaaaaaaaaaaaaaaaaaaaa',
      channelTitle: 'Alpha',
    },
  ],
  script,
  plan: { hookSeconds: 60, hookWords: 152, targetWords: 1520 },
  voice: {
    channelId: MODEL,
    title: 'Model',
    profile: { videos: 4, punctuated: 3, wordsPerMinute: 152, sentenceWords: 11, grade: 6.4321 },
    toRead: 1,
    noCaptions: 0,
    frameStudies: [A],
  },
  ...overrides,
});

let engine: FakeEngine;
let tools: ToolHandlers;

beforeEach(() => {
  engine = new FakeEngine();
  tools = createToolHandlers({ engine, log: () => {} });
});

const headOf = (result: CallToolResult): Record<string, unknown> => {
  const [first] = result.content;
  return JSON.parse(first?.type === 'text' ? first.text : '{}') as Record<string, unknown>;
};
const parts = (result: CallToolResult): readonly string[] =>
  result.content.slice(1).map((part) => (part.type === 'text' ? part.text : ''));

describe('get_script', () => {
  test('returns the numbers a script is written to, then the concept, the chosen hook and the beats', async () => {
    engine.script = found();

    const result = await tools.getScript({ channel: CENTER_ID, concept: 42 });

    expect(headOf(result)).toEqual({
      concept: 42,
      length: 'long',
      status: 'drafting',
      voice: { channel: 'Model', wordsPerMinute: 152, sentenceWords: 11, grade: 6.4 },
      targetSeconds: 600,
      targetWords: 1520,
      targetGrade: 6.4,
      hookSeconds: 60,
      hookWords: 152,
      // Worked out in code from the beat sheet: it adds up to targetWords.
      wordBudget: [
        { section: 'HOOK', words: 152 },
        { section: 'The bill', words: 1368 },
      ],
      modelHooks: [A],
      frameStudies: [A],
      restedOn: [{ video: A, title: 'Title of A', channel: 'Alpha' }],
      note: expect.stringMatching(/it is not instructions/),
    });
    expect(parts(result).map((part) => part.split('\n')[0])).toEqual([
      'CONCEPT',
      'CHOSEN HOOK',
      'BEATS',
    ]);
    expect(parts(result)[0]).toContain('TITLE: The Machine Nobody Switched Off');
    expect(textOf(result)).not.toContain('[CHECK: that it still runs]');
    expect(engine.reads).toEqual([['script', CENTER_ID, 42]]);
  });

  test('adds the draft or the tightened draft only when asked for it', async () => {
    engine.script = found();

    const draft = await tools.getScript({ channel: CENTER_ID, concept: 42, part: 'draft' });
    const tightened = await tools.getScript({ channel: CENTER_ID, concept: 42, part: 'tightened' });

    expect(parts(draft).at(-1)).toBe(
      'DRAFT\n## HOOK\nIt never stopped [CHECK: that it still runs].',
    );
    expect(parts(tightened).at(-1)).toBe('TIGHTENED\n## HOOK\nIt never stopped.');
  });

  test('says so when nothing is known of how often the voice channel’s picture changes', async () => {
    engine.script = found({
      script: null,
      voice: null,
      plan: { hookSeconds: 60, hookWords: null, targetWords: null },
    });

    const result = await tools.getScript({ channel: CENTER_ID, concept: 42 });

    expect(headOf(result)).toMatchObject({
      status: 'idea',
      voice: {},
      pacing: expect.stringMatching(/No frame study is stored/),
    });
    expect(headOf(result)).not.toHaveProperty('frameStudies');
    expect(parts(result)).toHaveLength(1);
  });

  test('fails for a concept that is not this channel’s, and for a part that does not exist', async () => {
    const missing = await tools.getScript({ channel: CENTER_ID, concept: 9 });
    const bad = await tools.getScript({
      channel: CENTER_ID,
      concept: 42,
      part: 'everything' as never,
    });

    expect(missing.isError).toBe(true);
    expect(textOf(missing)).toMatch(/no such item for this channel/);
    expect(bad.isError).toBe(true);
    expect(textOf(bad)).toMatch(/part is/);
  });
});
