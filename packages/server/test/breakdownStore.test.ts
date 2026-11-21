import {
  SqliteBreakdownRepo,
  markerLines,
  openDatabase,
  type StoredBreakdownPart,
} from '@jgtube/core';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { breakdownStore, breakdownView } from '../src/breakdownStore';

const T1 = new Date('2026-11-20T12:00:00Z');
const T2 = new Date('2026-11-21T09:30:00Z');
const CHANNEL = { id: `UC${'a'.repeat(22)}`, title: 'Some Bakery' };
const { start, end } = markerLines('MASTER PROMPT');

const written = (
  part: StoredBreakdownPart['part'],
  text: string,
  writtenAt = T1,
): StoredBreakdownPart => ({
  channelId: CHANNEL.id,
  part,
  written: true,
  engine: 'claude',
  text,
  writtenAt,
});

describe('a stored breakdown as the page shows it', () => {
  test('sets out every part in the order it is read, whether written, failed or missing', () => {
    const view = breakdownView(
      CHANNEL,
      [
        written('titles', 'THE TITLES STUDIED'),
        {
          channelId: CHANNEL.id,
          part: 'scripts',
          written: false,
          reason: 'Claude Code took too long.',
          writtenAt: T2,
        },
      ],
      null,
    );

    expect(view.parts.map((part) => [part.id, part.title, part.state])).toEqual([
      ['basis', 'What this rests on', 'missing'],
      ['titles', 'Titles', 'written'],
      ['thumbnails', 'Thumbnails', 'missing'],
      ['scripts', 'Scripts', 'failed'],
      ['picture', 'Picture and sound', 'missing'],
      ['strategy', 'Strengths, weaknesses and strategy', 'missing'],
      ['plan', 'Production plan', 'missing'],
      ['master', 'Master prompt', 'missing'],
    ]);
    expect(view.parts[1]).toEqual({
      id: 'titles',
      title: 'Titles',
      state: 'written',
      body: 'THE TITLES STUDIED',
      prompt: null,
      engine: 'claude',
      writtenAt: T1.toISOString(),
      reason: null,
    });
    expect(view.parts[3]).toMatchObject({
      body: '',
      prompt: null,
      engine: null,
      writtenAt: T2.toISOString(),
      reason: 'Claude Code took too long.',
    });
    expect(view.parts[0]).toMatchObject({ body: '', writtenAt: null, reason: null });
  });

  test('says when its newest part was written, and nothing when none is', () => {
    const parts = [written('titles', 'T', T1), written('plan', 'P', T2)];

    expect(breakdownView(CHANNEL, parts, null).writtenAt).toBe(T2.toISOString());
    expect(breakdownView(CHANNEL, [], null).writtenAt).toBeNull();
  });

  test('lifts a ready prompt out of its part, and leaves the part whole when the markers are missing', () => {
    const marked = written('master', `HOW TO USE IT\n\n${start}\nWrite a script.\n${end}`);
    const unmarked = written('master', 'Here is a prompt: write a script.');

    expect(breakdownView(CHANNEL, [marked], null).parts.at(-1)).toMatchObject({
      body: 'HOW TO USE IT',
      prompt: 'Write a script.',
    });
    expect(breakdownView(CHANNEL, [unmarked], null).parts.at(-1)).toMatchObject({
      body: 'Here is a prompt: write a script.',
      prompt: null,
    });
  });

  test('never takes marker lines in another part for a prompt', () => {
    const plan = written('plan', `STEP 1\n${start}\nNot a master prompt.\n${end}`);

    expect(breakdownView(CHANNEL, [plan], null).parts[6]).toMatchObject({
      body: plan.written ? plan.text : '',
      prompt: null,
    });
  });

  test('says which of the four texts there is to download, and why another is not', () => {
    const view = breakdownView(CHANNEL, [written('plan', 'STEP 1')], '/downloads/breakdowns/x');

    expect(view.folder).toBe('/downloads/breakdowns/x');
    expect(view.files).toEqual([
      { id: 'whole', name: 'breakdown.txt', available: true, reason: null },
      { id: 'plan', name: 'production-plan.txt', available: true, reason: null },
      {
        id: 'thumbnail',
        name: 'thumbnail-prompt.txt',
        available: false,
        reason: 'The thumbnails part has not been written.',
      },
      {
        id: 'master',
        name: 'master-prompt.txt',
        available: false,
        reason: 'The master prompt part has not been written.',
      },
    ]);
  });
});

describe('the stored breakdowns, read back and saved', () => {
  let root: string;
  let parts: SqliteBreakdownRepo;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'jgtube-breakdown-store-'));
    parts = new SqliteBreakdownRepo(openDatabase(':memory:'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const store = (rootOf: () => string = () => root) =>
    breakdownStore({ parts, now: () => T2, root: rootOf });

  test('have nothing to show for a channel no part was stored for', async () => {
    expect(await store().view(CHANNEL)).toBeNull();
  });

  test('show the folder only once the texts have been saved there', async () => {
    parts.saveWritten({ channelId: CHANNEL.id, part: 'plan', engine: 'claude', text: 'P' }, T1);

    expect((await store().view(CHANNEL))?.folder).toBeNull();
    const saved = await store().save(CHANNEL);

    expect(saved.saved).toEqual(['breakdown.txt', 'production-plan.txt']);
    expect(readdirSync(saved.folder).sort()).toEqual([
      'breakdown.txt',
      'index.json',
      'production-plan.txt',
    ]);
    expect((await store().view(CHANNEL))?.folder).toBe(saved.folder);
  });

  test('still show a breakdown when there is no downloads folder to look in', async () => {
    parts.saveWritten({ channelId: CHANNEL.id, part: 'plan', engine: 'claude', text: 'P' }, T1);
    const nowhere = store(() => {
      throw new Error('This store is only in memory');
    });

    expect((await nowhere.view(CHANNEL))?.folder).toBeNull();
    await expect(nowhere.save(CHANNEL)).rejects.toThrow(/only in memory/);
  });

  test('hand out each of the four texts from the store', () => {
    parts.saveWritten({ channelId: CHANNEL.id, part: 'plan', engine: 'claude', text: 'P' }, T1);

    expect(store().text(CHANNEL, 'plan')).toMatchObject({
      name: 'production-plan.txt',
      text: 'P\n',
    });
    expect(store().text(CHANNEL, 'master')).toMatchObject({ text: null });
    expect(() => store().text(CHANNEL, 'other' as never)).toThrow(/no such text/);
  });
});
