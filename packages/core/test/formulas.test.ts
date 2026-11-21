import { describe, expect, test } from 'vitest';
import {
  FORMULA_DEFAULT_WINDOW_DAYS,
  FORMULA_MIN_FIXED_WORDS,
  FORMULA_MIN_VIDEOS,
  FORMULA_WINDOWS,
  formulaParts,
  parseFormulas,
  verifyFormulas,
  type FormulaVideo,
} from '../src/formulas/formulas';

const CHANNEL_A = 'UCaaaaaaaaaaaaaaaaaaaaaa';
const CHANNEL_B = 'UCbbbbbbbbbbbbbbbbbbbbbb';

const video = (id: string, overrides: Partial<FormulaVideo> = {}): FormulaVideo => ({
  videoId: id,
  title: `Title of ${id}`,
  channelId: CHANNEL_A,
  channelTitle: 'Alpha',
  views: 10_000,
  score: 4,
  ageDays: 12,
  ...overrides,
});

const V1 = 'aaaaaaaaaa1';
const V2 = 'aaaaaaaaaa2';
const V3 = 'bbbbbbbbbb1';
const stored = new Map(
  [
    video(V1, { score: 6, views: 90_000 }),
    video(V2, { score: 2, views: 20_000 }),
    video(V3, { channelId: CHANNEL_B, channelTitle: 'Beta', score: null, views: 5000 }),
  ].map((one) => [one.videoId, one]),
);

const entry = (formula: string, videos: string, why = 'It promises a secret.'): string =>
  [`FORMULA: ${formula}`, `WHY: ${why}`, `VIDEOS: ${videos}`].join('\n');

describe('the windows a formula run can look at', () => {
  test('are thirty or ninety days, ninety unless the owner says', () => {
    expect(FORMULA_WINDOWS).toEqual([30, 90]);
    expect(FORMULA_DEFAULT_WINDOW_DAYS).toBe(90);
  });
});

describe('reading formulas from an answer', () => {
  test('reads the formula, the reason and the video ids of each entry', () => {
    const answer = [
      'TRENDING FORMATS',
      '',
      entry('Why [Thing] Quietly Disappeared', `${V1}, ${V2}`),
      '',
      entry(
        'The [Place] That [Did Something] Overnight',
        `${V3} and ${V1}.`,
        'A place and a jolt.',
      ),
    ].join('\n');

    expect(parseFormulas(answer)).toEqual({
      formulas: [
        {
          formula: 'Why [Thing] Quietly Disappeared',
          why: 'It promises a secret.',
          videoIds: [V1, V2],
        },
        {
          formula: 'The [Place] That [Did Something] Overnight',
          why: 'A place and a jolt.',
          videoIds: [V3, V1],
        },
      ],
      unread: 0,
    });
  });

  test('counts an entry with a part missing as unread', () => {
    const answer = [
      'FORMULA: Why [Thing] Quietly Disappeared',
      `VIDEOS: ${V1}, ${V2}`,
      '',
      entry('How [Thing] Works', `${V1}, ${V2}`),
    ].join('\n');

    const { formulas, unread } = parseFormulas(answer);

    expect(formulas.map((one) => one.formula)).toEqual(['How [Thing] Works']);
    expect(unread).toBe(1);
  });

  test('names each video once however often the answer repeats it', () => {
    const { formulas } = parseFormulas(entry('Why [Thing] Left', `${V1}, ${V1}, ${V2}`));

    expect(formulas[0]?.videoIds).toEqual([V1, V2]);
  });
});

describe('the parts of a formula', () => {
  test('are its fixed words and its named slots, in order', () => {
    expect(formulaParts('Why [Old Thing] Still Runs [Place]')).toEqual([
      { text: 'Why' },
      { slot: 'Old Thing' },
      { text: 'Still Runs' },
      { slot: 'Place' },
    ]);
  });
});

describe('what is kept of the formulas an engine gave', () => {
  const parsed = (formula: string, videoIds: readonly string[]) => ({
    formula,
    why: 'It promises a secret.',
    videoIds,
  });

  test('needs two videos behind a formula, and two fixed words in it', () => {
    expect(FORMULA_MIN_VIDEOS).toBe(2);
    expect(FORMULA_MIN_FIXED_WORDS).toBe(2);
  });

  test('keeps a formula with its videos from the store, strongest first, and works out the numbers itself', () => {
    const { kept, dropped } = verifyFormulas(
      [parsed('Why [Thing] Quietly Disappeared', [V2, V3, V1])],
      stored,
    );

    expect(dropped).toEqual([]);
    expect(kept).toEqual([
      {
        formula: 'Why [Thing] Quietly Disappeared',
        why: 'It promises a secret.',
        videos: [stored.get(V1), stored.get(V2), stored.get(V3)],
        videoCount: 3,
        channelCount: 2,
        // Two of the three have a score; the third is too alone to judge.
        averageScore: 4,
        scoredCount: 2,
      },
    ]);
  });

  test('drops a video that is not a stored video of this map inside the window', () => {
    const { kept } = verifyFormulas(
      [parsed('Why [Thing] Quietly Disappeared', [V1, 'zzzzzzzzzz9', V2])],
      stored,
    );

    expect(kept[0]?.videos.map((one) => one.videoId)).toEqual([V1, V2]);
  });

  test.each([
    ['fewer than two verified videos', 'Why [Thing] Quietly Disappeared', [V1, 'zzzzzzzzzz9']],
    ['no slot at all: that is a title, not a format', 'Why The Mill Quietly Disappeared', [V1, V2]],
    ['nothing but slots', '[Thing] [Action] [Place]', [V1, V2]],
    ['one fixed word around its slots', 'The [Thing] [Action]', [V1, V2]],
    ['a slot that was never closed', 'Why [Thing Quietly Disappeared', [V1, V2]],
  ])('drops a formula with %s, and says why', (reason, formula, ids) => {
    const { kept, dropped } = verifyFormulas([parsed(formula, ids)], stored);

    expect(kept).toEqual([]);
    expect(dropped).toHaveLength(1);
    expect(dropped[0]?.formula).toBe(formula);
    expect(dropped[0]?.reason.length).toBeGreaterThan(10);
    expect(reason.length).toBeGreaterThan(0);
  });

  test('keeps a formula once when the answer gives it twice', () => {
    const { kept } = verifyFormulas(
      [
        parsed('Why [Thing] Quietly Disappeared', [V1, V2]),
        parsed('why [thing] quietly disappeared', [V1, V3]),
      ],
      stored,
    );

    expect(kept).toHaveLength(1);
  });

  test('gives no average when none of its videos could be scored', () => {
    const unscored = new Map(
      [video(V1, { score: null }), video(V2, { score: null })].map((one) => [one.videoId, one]),
    );

    const { kept } = verifyFormulas(
      [parsed('Why [Thing] Quietly Disappeared', [V1, V2])],
      unscored,
    );

    expect(kept[0]).toMatchObject({ averageScore: null, scoredCount: 0, videoCount: 2 });
  });
});
