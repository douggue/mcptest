import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { MAX_BEAT_CHARS, parseHooksAndBeats, readBeats, scriptBody } from '../src/script/stages';

const A = 'aaaaaaaaaa1';

const hook = (number: number, model: string, text = `Words of hook ${number}.`): string =>
  [`HOOK ${number}`, `WAY: way number ${number}`, `MODEL: ${model}`, `TEXT: ${text}`].join('\n');

const ANSWER = [
  hook(1, `${A} (scene then reveal)`),
  hook(2, 'none'),
  hook(3, 'none'),
  'BEATS',
  'BEAT: 1:00 | The bill | Who has been paying for the power',
  'BEAT: 2:30 | The plant | What it made and why it closed',
].join('\n\n');

describe('reading the hooks and the beat sheet', () => {
  test('reads three hooks, each with its way and the library hook it learns from, then the beats', () => {
    expect(parseHooksAndBeats(ANSWER)).toEqual({
      hooks: [
        { way: 'way number 1', model: A, text: 'Words of hook 1.' },
        { way: 'way number 2', model: null, text: 'Words of hook 2.' },
        { way: 'way number 3', model: null, text: 'Words of hook 3.' },
      ],
      beats: [
        '1:00 | The bill | Who has been paying for the power',
        '2:30 | The plant | What it made and why it closed',
      ],
      problem: null,
      notes: [],
    });
  });

  test('takes no more than three hooks, and reads beats set directly under one another', () => {
    const answer = [
      hook(1, 'none'),
      hook(2, 'none'),
      hook(3, 'none'),
      hook(4, 'none'),
      'BEATS\nBEAT: 1:00 | One | First\nBEAT: 2:00 | Two | Second',
    ].join('\n\n');

    const { hooks, beats } = parseHooksAndBeats(answer);

    expect(hooks).toHaveLength(3);
    expect(beats).toEqual(['1:00 | One | First', '2:00 | Two | Second']);
  });

  test('leaves out a hook without its words, and says so when none is left or there are no beats', () => {
    const noWords = ['HOOK 1', 'WAY: a way', 'MODEL: none', '', 'BEATS', 'BEAT: 1:00 | One'].join(
      '\n',
    );

    expect(parseHooksAndBeats(noWords)).toMatchObject({ hooks: [], problem: /no hook/ });
    expect(parseHooksAndBeats(hook(1, 'none'))).toMatchObject({
      hooks: [{ way: 'way number 1' }],
      beats: [],
      problem: 'It holds no beat sheet.',
    });
    expect(parseHooksAndBeats('I could not reach the tools.').problem).toMatch(/no hook/);
  });
});

describe('a beat sheet written at length', () => {
  /** What a real run wrote: nine beats of 257 to 946 characters. The old reader kept two. */
  const real = readFileSync(
    fileURLToPath(new URL('./fixtures/hooksLongBeats.txt', import.meta.url)),
    'utf8',
  );

  test('keeps every beat a real run wrote, whole, and has nothing to report', () => {
    const { hooks, beats, problem, notes } = parseHooksAndBeats(real);

    expect(problem).toBeNull();
    expect(hooks).toHaveLength(3);
    expect(beats).toHaveLength(9);
    expect(beats.map((beat) => beat.split(' | ')[0])).toEqual([
      '1:00',
      '2:15',
      '3:00',
      '5:30',
      '7:45',
      '9:30',
      '12:00',
      '13:15',
      '14:50',
    ]);
    expect(Math.max(...beats.map((beat) => beat.length))).toBeGreaterThan(900);
    expect(notes).toEqual([]);
  });

  test('shortens a beat that is far too long at the end of a sentence, keeps it, and says so', () => {
    const sentence = 'Something happens here and it is told at length. ';
    const long = `2:00 | The long one | ${sentence.repeat(40)}`;
    const answer = [hook(1, 'none'), 'BEATS', 'BEAT: 1:00 | Short | Fine.', `BEAT: ${long}`].join(
      '\n',
    );

    const { beats, notes, problem } = parseHooksAndBeats(answer);

    expect(problem).toBeNull();
    expect(beats).toHaveLength(2);
    expect(beats[1]?.startsWith('2:00 | The long one | Something happens')).toBe(true);
    expect(beats[1]?.length).toBeLessThanOrEqual(MAX_BEAT_CHARS);
    expect(beats[1]?.endsWith('told at length.')).toBe(true);
    expect(notes).toEqual([
      'Beat 2 (“The long one”) was longer than a beat sheet keeps, so it was shortened at the end of a sentence. Read it and put back what matters.',
    ]);
  });

  test('cuts at a word when a long beat has no sentence to end on', () => {
    const answer = [hook(1, 'none'), 'BEATS', `BEAT: 1:00 | Run on | ${'word '.repeat(400)}`].join(
      '\n',
    );

    const { beats, notes } = parseHooksAndBeats(answer);

    expect(beats[0]?.length).toBeLessThanOrEqual(MAX_BEAT_CHARS);
    expect(beats[0]?.endsWith('word…')).toBe(true);
    expect(notes).toHaveLength(1);
  });

  test('says how many beats were written when a sheet holds more than are kept', () => {
    const many = Array.from({ length: 125 }, (_, at) => `BEAT: ${at}:00 | Beat ${at} | x`);

    const { beats, notes } = parseHooksAndBeats([hook(1, 'none'), 'BEATS', ...many].join('\n'));

    expect(beats).toHaveLength(120);
    expect(notes).toEqual(['The AI wrote 125 beats; a beat sheet keeps the first 120.']);
  });
});

describe('the script in an answer', () => {
  test('starts at its first heading, whatever was said before it, and loses its code fences', () => {
    const answer = ['Here is the draft.', '', '```', '## HOOK', 'It never stopped.', '```'].join(
      '\n',
    );

    expect(scriptBody(answer)).toBe('## HOOK\nIt never stopped.');
  });

  test('is the whole answer when it has no heading', () => {
    expect(scriptBody('  It never stopped.\n')).toBe('It never stopped.');
  });
});

describe('a beat sheet', () => {
  test('is read a line at a time: when it starts, its name, what happens', () => {
    expect(readBeats('1:00 | The bill | Who paid | and why\n\nThe plant\n2:30 | The end')).toEqual([
      { time: '1:00', name: 'The bill', what: 'Who paid | and why' },
      { time: '', name: 'The plant', what: '' },
      { time: '2:30', name: 'The end', what: '' },
    ]);
    expect(readBeats('')).toEqual([]);
  });
});
