import { describe, expect, test } from 'vitest';
import { BIBLE_SYSTEM_PROMPT, BIBLE_TITLE, bibleQuestion } from '../src/formatBibleQuestions';
import { mixRequest, runTitle, type MixAsk } from '../src/formatMixRequests';

const CHANNEL = 'UCcccccccccccccccccccccc';
const settings = {
  projectRoot: '/jgtube',
  dbPath: '/data/jgtube.db',
  workDir: '/work',
  downloadsPath: '/data/downloads',
};
const ask = (parts: Partial<MixAsk> = {}): MixAsk => ({
  formatId: 4,
  formatName: 'Long-form',
  channel: null,
  pictures: [],
  thumbnails: [],
  purpose: 'bible',
  ...parts,
});

describe('the Format Bible question', () => {
  test('reads the filled slots and asks for every section, numbers only from the tool', () => {
    const text = bibleQuestion(ask(), '');
    expect(text).toContain('get_format_shelf with format 4');
    expect(text).toContain('the slots that are filled');
    for (const key of [
      'coreRules',
      'visualSystem',
      'typography',
      'components',
      'motion',
      'pacing',
      'hook',
      'chapters',
      'titleFormulas',
      'thumbnails',
      'sound',
      'pipeline',
      'masterPrompt',
      'doNotCopy',
    ]) {
      expect(text).toContain(`"${key}"`);
    }
    expect(text).toMatch(/hex codes measured/);
    expect(bibleQuestion(ask({ channel: CHANNEL }), '')).toContain(
      `get_map and get_breakouts for the channel ${CHANNEL}`,
    );
    expect(BIBLE_SYSTEM_PROMPT).toMatch(/never invent a number/);
  });

  test('a Bible run uses the same read-only tools, with more room than a mix', () => {
    const request = mixRequest(ask(), 'claude', settings);
    expect(request.prompt).toContain('"masterPrompt"');
    expect(request.systemPrompt).toBe(BIBLE_SYSTEM_PROMPT);
    expect(request.allowedTools).toEqual(['mcp__jgtube__get_format_shelf']);
    expect(request.maxTurns).toBe(12);
    const pictured = mixRequest(ask({ thumbnails: ['aaaaaaaaaa1'] }), 'claude', settings);
    expect(pictured.allowedTools).toContain('mcp__jgtube__view_thumbnails');
    expect(pictured.maxTurns).toBe(18);
    expect(mixRequest(ask({ purpose: 'mix' }), 'claude', settings).prompt).toContain(
      '"ingredient": 12',
    );
  });

  test('the run is named for what it does', () => {
    expect(runTitle(ask())).toBe(BIBLE_TITLE);
    expect(runTitle(ask({ purpose: 'mix' }))).toBe('Suggest a mix');
  });
});
