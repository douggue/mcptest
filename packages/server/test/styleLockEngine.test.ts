import {
  SqliteBreakdownRepo,
  SqliteChannelNoteRepo,
  SqliteChannelRepo,
  markerLines,
  openDatabase,
} from '@jgtube/core';
import { beforeEach, describe, expect, test } from 'vitest';
import { styleLockEngine, type StyleLockEngine } from '../src/styleLockEngine';

const NOW = new Date('2026-11-21T12:00:00Z');
const MINE = `UC${'m'.repeat(22)}`;
const MODEL = `UC${'d'.repeat(22)}`;
const PLAIN = `UC${'p'.repeat(22)}`;
const { start, end } = markerLines('STYLE LOCK');

let engine: StyleLockEngine;
let notes: SqliteChannelNoteRepo;

beforeEach(() => {
  const db = openDatabase(':memory:');
  const channels = new SqliteChannelRepo(db);
  for (const [id, title] of [
    [MINE, 'Mine'],
    [MODEL, 'Model'],
    [PLAIN, 'Plain'],
  ] as const) {
    channels.upsert(
      { id, title, handle: null, subscribers: 10, subscribersHidden: false, videoCount: null },
      NOW,
    );
  }
  const breakdowns = new SqliteBreakdownRepo(db);
  breakdowns.saveWritten(
    {
      channelId: MODEL,
      part: 'picture',
      engine: 'claude',
      text: `PICTURE STYLE\n- Ink.\n${start}\nSTYLE BLOCK: Flat ink.\n${end}`,
    },
    NOW,
  );
  breakdowns.saveWritten(
    { channelId: PLAIN, part: 'picture', engine: 'claude', text: 'NO CONSISTENT STYLE' },
    NOW,
  );
  notes = new SqliteChannelNoteRepo(db);
  engine = styleLockEngine({
    now: () => NOW,
    repos: { channels, breakdowns, notes },
  });
});

describe('using a breakdown’s style lock for the owner’s channel', () => {
  test('keeps the lock with the channel it came from, for the page and for a tool', () => {
    const used = engine.useStyleLock(MINE, MODEL);

    expect(used).toEqual({
      channelId: MINE,
      from: { id: MODEL, title: 'Model' },
      text: 'STYLE BLOCK: Flat ink.',
      writtenAt: NOW.toISOString(),
    });
    expect(engine.findStyleLock(MINE)).toEqual(used);
    expect(notes.find(MINE, 'style-lock')?.text).toContain('STYLE BLOCK: Flat ink.');
  });

  test('is refused for a breakdown with no style lock, and for a channel that is not stored', () => {
    expect(() => engine.useStyleLock(MINE, PLAIN)).toThrow(/no style lock/);
    expect(() => engine.useStyleLock(`UC${'z'.repeat(22)}`, MODEL)).toThrow(/not stored/);
    expect(engine.findStyleLock(MINE)).toBeNull();
  });

  test('can be stopped', () => {
    engine.useStyleLock(MINE, MODEL);
    engine.stopStyleLock(MINE);

    expect(engine.findStyleLock(MINE)).toBeNull();
  });
});
