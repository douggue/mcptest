import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { BREAKDOWN_PART_TITLES, markerLines } from '../src/breakdown/parts';
import {
  BREAKDOWNS_FOLDER,
  BREAKDOWN_FILES,
  BREAKDOWN_INDEX_FILE,
  breakdownFolder,
  breakdownTexts,
  saveBreakdownTexts,
} from '../src/downloads/breakdownTexts';
import type { StoredBreakdownPart } from '../src/repos/types';

const AT = new Date('2026-11-21T09:30:00Z');
const CHANNEL = { id: `UC${'a'.repeat(22)}`, title: 'Some Bakery' };
const thumb = markerLines('THUMBNAIL PROMPT');
const master = markerLines('MASTER PROMPT');

const written = (part: StoredBreakdownPart['part'], text: string): StoredBreakdownPart => ({
  channelId: CHANNEL.id,
  part,
  written: true,
  engine: part === 'basis' ? 'jgtube' : 'claude',
  text,
  writtenAt: AT,
});
const failed = (part: StoredBreakdownPart['part'], reason: string): StoredBreakdownPart => ({
  channelId: CHANNEL.id,
  part,
  written: false,
  reason,
  writtenAt: AT,
});

const WHOLE: readonly StoredBreakdownPart[] = [
  written('basis', '41 videos stored.'),
  written('titles', 'THE TITLES STUDIED\n- 40 titles.'),
  written(
    'thumbnails',
    `COMPOSITION\n- A face.\n\n${thumb.start}\nA photo of [SUBJECT] with the words [OVERLAY TEXT].\n${thumb.end}`,
  ),
  written('scripts', 'THE HOOK\n- A question.'),
  written('picture', 'KINDS OF SHOT\n- Stills.'),
  written('strategy', 'STRENGTHS\n- Hooks.'),
  written('plan', 'STEP 1: RESEARCH\n- Check every fact.'),
  written(
    'master',
    `HOW TO USE IT\n\n${master.start}\nWrite a script. Mark [CHECK: ...].\n${master.end}`,
  ),
];

const byId = (parts: readonly StoredBreakdownPart[]) =>
  Object.fromEntries(breakdownTexts(CHANNEL, parts).map((file) => [file.id, file]));

describe('the four texts of a breakdown', () => {
  test('have fixed names that are the same for every channel', () => {
    expect(BREAKDOWN_FILES).toEqual({
      whole: 'breakdown.txt',
      plan: 'production-plan.txt',
      thumbnail: 'thumbnail-prompt.txt',
      master: 'master-prompt.txt',
    });
  });

  test('are the whole breakdown, the production plan and the two prompts lifted out as they stand', () => {
    const files = byId(WHOLE);

    expect(Object.keys(files)).toEqual(['whole', 'plan', 'thumbnail', 'master']);
    expect(files['plan']).toMatchObject({
      name: 'production-plan.txt',
      text: 'STEP 1: RESEARCH\n- Check every fact.\n',
    });
    expect(files['thumbnail']?.text).toBe('A photo of [SUBJECT] with the words [OVERLAY TEXT].\n');
    expect(files['master']?.text).toBe('Write a script. Mark [CHECK: ...].\n');
  });

  test('set the whole breakdown out part by part, in order, under the channel’s name', () => {
    const text = byId(WHOLE)['whole']?.text ?? '';
    const at = (needle: string): number => text.indexOf(needle);

    expect(text.startsWith('CHANNEL BREAKDOWN: Some Bakery\n')).toBe(true);
    expect(text).toContain(`https://www.youtube.com/channel/${CHANNEL.id}`);
    expect(text).toContain('Written 2026-11-21');
    expect(text).toContain('Check every fact before you publish');
    for (const title of Object.values(BREAKDOWN_PART_TITLES)) {
      expect(text).toContain(title.toUpperCase());
    }
    expect(at('WHAT THIS RESTS ON')).toBeLessThan(at('PART 1 OF 7: TITLES'));
    expect(at('PART 1 OF 7: TITLES')).toBeLessThan(at('PART 6 OF 7: PRODUCTION PLAN'));
    expect(at('PART 6 OF 7: PRODUCTION PLAN')).toBeLessThan(at('PART 7 OF 7: MASTER PROMPT'));
    expect(text).toContain('- 40 titles.');
    expect(text).toContain(thumb.start);
  });

  test('say in the whole breakdown which part was not written, and why', () => {
    const parts = WHOLE.map((part) =>
      part.part === 'scripts' ? failed('scripts', 'Claude Code took too long.') : part,
    );

    const text = byId(parts)['whole']?.text ?? '';

    expect(text).toContain('PART 3 OF 7: SCRIPTS');
    expect(text).toContain('NOT WRITTEN: Claude Code took too long.');
  });

  test('leave the plan out, with the reason, when it was not written', () => {
    const missing = byId(WHOLE.filter((part) => part.part !== 'plan'))['plan'];
    const broken = byId(
      WHOLE.map((part) =>
        part.part === 'plan' ? failed('plan', 'A plan limit was reached.') : part,
      ),
    )['plan'];

    expect(missing).toMatchObject({
      text: null,
      reason: 'The production plan has not been written.',
    });
    expect(broken).toMatchObject({
      text: null,
      reason: 'The production plan was not written: A plan limit was reached.',
    });
  });

  test('never guess at a prompt whose marker lines are missing', () => {
    const parts = WHOLE.map((part) =>
      part.part === 'master' ? written('master', 'Here is a prompt: write a script.') : part,
    );

    const files = byId(parts);

    expect(files['master']).toMatchObject({
      text: null,
      reason:
        'The master prompt part does not hold a prompt between the two marker lines it was asked for, so nothing was saved.',
    });
    expect(files['thumbnail']?.text).not.toBeNull();
  });

  test('have nothing to give for a channel with no part written', () => {
    const files = breakdownTexts(CHANNEL, [failed('titles', 'No.')]);

    expect(files.every((file) => file.text === null)).toBe(true);
    expect(files[0]?.reason).toBe('No part of the breakdown has been written.');
  });
});

describe('saving a breakdown’s texts', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'jgtube-breakdown-texts-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test('writes four text files and an index in a folder named after the channel', async () => {
    const saved = await saveBreakdownTexts(root, CHANNEL, breakdownTexts(CHANNEL, WHOLE), AT);

    expect(saved.folder).toBe(join(root, BREAKDOWNS_FOLDER, 'Some Bakery'));
    expect(readdirSync(saved.folder).sort()).toEqual([
      'breakdown.txt',
      'index.json',
      'master-prompt.txt',
      'production-plan.txt',
      'thumbnail-prompt.txt',
    ]);
    expect(saved.saved).toEqual([
      'breakdown.txt',
      'production-plan.txt',
      'thumbnail-prompt.txt',
      'master-prompt.txt',
    ]);
    expect(saved.notSaved).toEqual([]);
    expect(readFileSync(join(saved.folder, 'master-prompt.txt'), 'utf8')).toBe(
      'Write a script. Mark [CHECK: ...].\n',
    );
    expect(JSON.parse(readFileSync(saved.indexFile, 'utf8'))).toEqual({
      channelId: CHANNEL.id,
      channelTitle: 'Some Bakery',
      savedAt: AT.toISOString(),
      files: saved.saved,
      notSaved: [],
    });
  });

  test('saves nothing for a prompt it could not find, says so, and removes an older copy', async () => {
    await saveBreakdownTexts(root, CHANNEL, breakdownTexts(CHANNEL, WHOLE), AT);
    const parts = WHOLE.map((part) =>
      part.part === 'thumbnails' ? written('thumbnails', 'COMPOSITION\n- A face.') : part,
    );

    const saved = await saveBreakdownTexts(root, CHANNEL, breakdownTexts(CHANNEL, parts), AT);

    expect(existsSync(join(saved.folder, 'thumbnail-prompt.txt'))).toBe(false);
    expect(saved.saved).not.toContain('thumbnail-prompt.txt');
    expect(saved.notSaved).toEqual([
      {
        file: 'thumbnail-prompt.txt',
        reason:
          'The thumbnails part does not hold a prompt between the two marker lines it was asked for, so nothing was saved.',
      },
    ]);
    expect(JSON.parse(readFileSync(saved.indexFile, 'utf8')).notSaved).toEqual(saved.notSaved);
  });

  test('gives a second channel of the same name a folder of its own', async () => {
    const twin = { id: `UC${'b'.repeat(22)}`, title: 'Some Bakery' };
    await saveBreakdownTexts(root, CHANNEL, breakdownTexts(CHANNEL, WHOLE), AT);

    const saved = await saveBreakdownTexts(root, twin, breakdownTexts(twin, WHOLE), AT);

    expect(saved.folder).toBe(join(root, BREAKDOWNS_FOLDER, `Some Bakery [${twin.id}]`));
  });

  test('never writes outside the downloads folder, whatever the channel is called', async () => {
    const odd = { id: CHANNEL.id, title: '../../outside' };

    const saved = await saveBreakdownTexts(root, odd, breakdownTexts(odd, WHOLE), AT);

    expect(saved.folder.startsWith(join(root, BREAKDOWNS_FOLDER))).toBe(true);
    expect(readdirSync(root)).toEqual([BREAKDOWNS_FOLDER]);
  });

  test('finds the folder again only when it holds this channel’s saved breakdown', async () => {
    expect(await breakdownFolder(root, CHANNEL)).toBeNull();

    const saved = await saveBreakdownTexts(root, CHANNEL, breakdownTexts(CHANNEL, WHOLE), AT);

    expect(await breakdownFolder(root, CHANNEL)).toBe(saved.folder);
    const stranger = { id: `UC${'c'.repeat(22)}`, title: 'Some Bakery' };
    expect(await breakdownFolder(root, stranger)).toBeNull();
    mkdirSync(join(root, BREAKDOWNS_FOLDER, 'Empty'), { recursive: true });
    writeFileSync(join(root, BREAKDOWNS_FOLDER, 'Empty', BREAKDOWN_INDEX_FILE), 'not json');
    expect(await breakdownFolder(root, { id: stranger.id, title: 'Empty' })).toBeNull();
  });
});
