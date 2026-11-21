import { describe, expect, test } from 'vitest';
import { ApiError, createApi } from '../src/lib/api';
import {
  attachmentOf,
  copyFailedText,
  durationText,
  hasGaps,
  partNote,
  runLines,
  savedLine,
  textUrl,
  writtenLine,
  type BreakdownPartView,
  type BreakdownView,
  type PartRun,
} from '../src/lib/breakdownParts';

const CHANNEL = `UC${'a'.repeat(22)}`;
const AT = '2026-11-21T09:30:00.000Z';
/** A fixed way of writing a time, so the tests read the same on any computer. */
const fixed = (date: Date): string => date.toISOString().slice(0, 16).replace('T', ' ');

const part = (overrides: Partial<BreakdownPartView> = {}): BreakdownPartView => ({
  id: 'titles',
  title: 'Titles',
  state: 'written',
  body: 'THE TITLES STUDIED',
  prompt: null,
  engine: 'claude',
  writtenAt: AT,
  reason: null,
  ...overrides,
});

const view = (overrides: Partial<BreakdownView> = {}): BreakdownView => ({
  channel: { id: CHANNEL, title: 'Some Bakery' },
  writtenAt: AT,
  parts: [
    part({ id: 'basis', title: 'What this rests on', engine: 'jgtube', body: '41 videos stored.' }),
    part(),
    part({
      id: 'thumbnails',
      title: 'Thumbnails',
      body: 'COMPOSITION',
      prompt: 'A photo of [SUBJECT].',
    }),
    part({ id: 'plan', title: 'Production plan', body: 'STEP 1: RESEARCH' }),
    part({
      id: 'master',
      title: 'Master prompt',
      body: 'HOW TO USE IT',
      prompt: 'Write a script.',
    }),
  ],
  files: [
    { id: 'whole', name: 'breakdown.txt', available: true, reason: null },
    { id: 'plan', name: 'production-plan.txt', available: true, reason: null },
    { id: 'thumbnail', name: 'thumbnail-prompt.txt', available: true, reason: null },
    { id: 'master', name: 'master-prompt.txt', available: true, reason: null },
  ],
  folder: 'C:\\jgtube\\downloads\\breakdowns\\Some Bakery',
  ...overrides,
});

describe('writtenLine', () => {
  test('says when a stored breakdown was written', () => {
    expect(writtenLine(view(), fixed)).toBe('Written 2026-11-21 09:30.');
  });

  test('says so when parts are missing, and when nothing is written at all', () => {
    const gaps = view({
      parts: [part(), part({ id: 'scripts', title: 'Scripts', state: 'failed' })],
    });

    expect(writtenLine(gaps, fixed)).toBe('Written 2026-11-21 09:30. 1 part is not written.');
    expect(writtenLine(view({ writtenAt: null }), fixed)).toBe('No part of it is written yet.');
  });

  test('copes with a time it cannot read', () => {
    expect(writtenLine(view({ writtenAt: 'yesterday' }), fixed)).toBe('Written.');
  });
});

describe('hasGaps', () => {
  test('is true only when some part is failed or missing', () => {
    expect(hasGaps(view())).toBe(false);
    expect(hasGaps(view({ parts: [part(), part({ state: 'missing' })] }))).toBe(true);
    expect(hasGaps(view({ parts: [part({ state: 'failed' })] }))).toBe(true);
  });
});

describe('partNote', () => {
  test('says who wrote a part, in the names a creator knows', () => {
    expect(partNote(part())).toBe('Written by Claude Code');
    expect(partNote(part({ engine: 'agy' }))).toBe('Written by Antigravity');
    expect(partNote(part({ engine: 'jgtube' }))).toBe('Worked out by Jgtube');
    expect(partNote(part({ engine: 'something-new' }))).toBe('Written by something-new');
  });

  test('says why a part is not there', () => {
    expect(partNote(part({ state: 'failed', reason: 'Claude Code took too long.' }))).toBe(
      'Not written: Claude Code took too long.',
    );
    expect(partNote(part({ state: 'failed', reason: null }))).toBe('Not written');
    expect(partNote(part({ state: 'missing' }))).toBe('Not written yet');
  });
});

describe('attachmentOf', () => {
  test('gives the production plan whole, to copy and to download', () => {
    expect(attachmentOf(view(), 'plan')).toEqual({
      label: 'production plan',
      text: 'STEP 1: RESEARCH',
      inBody: true,
      file: { id: 'plan', name: 'production-plan.txt', available: true, reason: null },
      problem: null,
    });
  });

  test('gives the thumbnail prompt and the master prompt as they were lifted out', () => {
    expect(attachmentOf(view(), 'thumbnails')).toMatchObject({
      label: 'thumbnail prompt',
      text: 'A photo of [SUBJECT].',
      inBody: false,
      file: { name: 'thumbnail-prompt.txt' },
    });
    expect(attachmentOf(view(), 'master')).toMatchObject({
      label: 'master prompt',
      text: 'Write a script.',
      inBody: false,
    });
  });

  test('says why there is no prompt, and never offers a guess', () => {
    const reason =
      'The master prompt part does not hold a prompt between the two marker lines it was asked for, so nothing was saved.';
    const unmarked = view({
      parts: [
        part({ id: 'master', title: 'Master prompt', body: 'A prompt: write.', prompt: null }),
      ],
      files: [{ id: 'master', name: 'master-prompt.txt', available: false, reason }],
    });

    expect(attachmentOf(unmarked, 'master')).toMatchObject({ text: null, problem: reason });
  });

  test('has nothing to attach to a part that is not written, or to the other parts', () => {
    const failed = view({ parts: [part({ id: 'plan', state: 'failed', body: '' })] });

    expect(attachmentOf(failed, 'plan')).toBeNull();
    expect(attachmentOf(view(), 'titles')).toBeNull();
    expect(attachmentOf(view(), 'basis')).toBeNull();
    expect(attachmentOf(view({ parts: [] }), 'master')).toBeNull();
  });
});

describe('textUrl', () => {
  test('points at the server’s own download of one text for one channel', () => {
    expect(textUrl(CHANNEL, 'master-prompt.txt')).toBe(
      `/api/breakdowns/texts/master-prompt.txt?channel=${CHANNEL}`,
    );
    expect(textUrl('@a b', 'breakdown.txt')).toBe(
      '/api/breakdowns/texts/breakdown.txt?channel=%40a%20b',
    );
  });
});

describe('savedLine', () => {
  test('says where the text files were saved', () => {
    expect(savedLine(view(), null)).toBe(
      'The breakdown, the production plan, the thumbnail prompt and the master prompt are saved as text files in C:\\jgtube\\downloads\\breakdowns\\Some Bakery',
    );
  });

  test('names only the files there are', () => {
    const some = view({
      files: [
        { id: 'whole', name: 'breakdown.txt', available: true, reason: null },
        { id: 'plan', name: 'production-plan.txt', available: true, reason: null },
        { id: 'thumbnail', name: 'thumbnail-prompt.txt', available: false, reason: 'No.' },
        { id: 'master', name: 'master-prompt.txt', available: false, reason: 'No.' },
      ],
    });

    expect(savedLine(some, null)).toBe(
      'The breakdown and the production plan are saved as text files in C:\\jgtube\\downloads\\breakdowns\\Some Bakery',
    );
  });

  test('says why they were not saved, and that they can still be downloaded', () => {
    expect(savedLine(view({ folder: null }), 'There is no downloads folder.')).toBe(
      'The text files were not saved on this computer: There is no downloads folder. You can still download each one below.',
    );
    expect(savedLine(view({ folder: null }), null)).toBe(
      'The text files are not saved on this computer yet. You can download each one below.',
    );
  });
});

describe('durationText', () => {
  test('writes seconds as a person says them', () => {
    expect(durationText(0)).toBe('under a second');
    expect(durationText(42)).toBe('42 s');
    expect(durationText(60)).toBe('1 min');
    expect(durationText(135)).toBe('2 min 15 s');
  });
});

describe('runLines', () => {
  const runs: readonly PartRun[] = [
    { part: 'titles', outcome: 'written', engine: 'claude', skipped: [], seconds: 72 },
    { part: 'thumbnails', outcome: 'kept', engine: 'codex', seconds: 0 },
    { part: 'scripts', outcome: 'failed', reason: 'Claude Code took too long.', seconds: 900 },
  ];

  test('say how writing each part went, and how long it took', () => {
    expect(runLines(runs)).toEqual([
      'Titles: written by Claude Code in 1 min 12 s.',
      'Thumbnails: kept from the last breakdown (written by Codex), since nothing it rests on has changed.',
      'Scripts: not written after 15 min. Claude Code took too long.',
      'Writing took 16 min 12 s in all.',
    ]);
  });

  test('name an engine that was passed over on the way', () => {
    const skipped: readonly PartRun[] = [
      {
        part: 'master',
        outcome: 'written',
        engine: 'codex',
        skipped: [{ engine: 'claude', reason: 'limit', message: 'A plan limit was reached.' }],
        seconds: 30,
      },
    ];

    expect(runLines(skipped)[0]).toBe(
      'Master prompt: written by Codex in 30 s. Claude Code was passed over: A plan limit was reached.',
    );
  });

  test('say when nothing had to be written', () => {
    expect(runLines([{ part: 'titles', outcome: 'kept', engine: 'claude', seconds: 0 }])).toEqual([
      'Titles: kept from the last breakdown (written by Claude Code), since nothing it rests on has changed.',
      'Nothing had changed, so nothing was written again. Tick “Start again from nothing” to have everything studied and written again.',
    ]);
    expect(runLines([])).toEqual([]);
  });
});

describe('copyFailedText', () => {
  test('tells the owner what to do when the browser will not copy', () => {
    expect(copyFailedText('master prompt')).toBe(
      'The browser would not copy the master prompt. Use “Download .txt” instead.',
    );
  });
});

describe('the stored breakdown, through the API', () => {
  const reply = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  test('is read for one channel', async () => {
    const asked: string[] = [];
    const api = createApi(async (input) => {
      asked.push(input);
      return reply(200, { success: true, data: view(), error: null, meta: null });
    });

    expect(await api.storedBreakdown(CHANNEL)).toEqual(view());
    expect(asked).toEqual([`/api/breakdowns?channel=${CHANNEL}`]);
  });

  test('is nothing when none has been written, and a failure otherwise', async () => {
    const none = createApi(async () =>
      reply(200, { success: true, data: null, error: null, meta: null }),
    );
    const broken = createApi(async () =>
      reply(500, {
        success: false,
        data: null,
        error: 'The breakdown could not be read',
        meta: null,
      }),
    );

    expect(await none.storedBreakdown(CHANNEL)).toBeNull();
    await expect(broken.storedBreakdown(CHANNEL)).rejects.toBeInstanceOf(ApiError);
  });
});
