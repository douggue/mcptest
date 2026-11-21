import { describe, expect, test } from 'vitest';
import {
  LATIN_MIN_SHARE,
  checkMarkers,
  cleanVoiceover,
  countSyllables,
  countWords,
  isMostlyLatin,
  readingGrade,
  sentenceLength,
  spokenSeconds,
  spokenText,
  stripCheckMarkers,
} from '../src/script/measure';
import { parseCues, shotListCsv, toCsv } from '../src/script/cues';

const SCRIPT = [
  '## HOOK',
  '[B-ROLL: a rusted press in an empty hall | abandoned factory machine | low hum]',
  'Nobody switched it off. The plant closed in 1987 [CHECK: the year the plant closed], and the press kept running.',
  '',
  '## BEAT 1: Who paid the bill',
  '[B-ROLL: an old electricity meter spinning | vintage electricity meter | ]',
  'Somebody was paying for the power [CHECK: who paid the bill]. That is the first question.',
].join('\n');

describe('what is spoken', () => {
  test('is the script without its headings, its picture cues and its check markers', () => {
    expect(spokenText(SCRIPT)).toBe(
      [
        'Nobody switched it off. The plant closed in 1987, and the press kept running.',
        '',
        'Somebody was paying for the power. That is the first question.',
      ].join('\n'),
    );
  });

  test('keeps the claim a marker follows, and tidies the space the marker leaves', () => {
    expect(spokenText('It weighs 40 tonnes [CHECK: the weight] .')).toBe('It weighs 40 tonnes.');
    expect(spokenText('Built in Ohio [CHECK: where]\nand shipped.')).toBe(
      'Built in Ohio\nand shipped.',
    );
  });

  test('is counted in words, with cues, markers and headings counting for nothing', () => {
    expect(countWords('one two  three\nfour')).toBe(4);
    expect(countWords(SCRIPT)).toBe(25);
    expect(countWords('')).toBe(0);
    expect(countWords('— … !')).toBe(0);
  });

  test('takes time at a words-per-minute rate', () => {
    expect(spokenSeconds(150, 150)).toBe(60);
    expect(spokenSeconds(100, 150)).toBe(40);
    expect(spokenSeconds(100, 0)).toBeNull();
    expect(spokenSeconds(0, 150)).toBe(0);
  });
});

describe('the clean voiceover text', () => {
  test('is only what is said, a paragraph to each part, ready for a voice', () => {
    expect(cleanVoiceover(SCRIPT)).toBe(
      'Nobody switched it off. The plant closed in 1987, and the press kept running.\n\nSomebody was paying for the power. That is the first question.',
    );
  });
});

describe('the facts still to check', () => {
  test('are listed in order, each with the sentence it stands in', () => {
    expect(checkMarkers(SCRIPT)).toEqual([
      {
        what: 'the year the plant closed',
        near: 'The plant closed in 1987, and the press kept running.',
      },
      { what: 'who paid the bill', near: 'Somebody was paying for the power.' },
    ]);
  });

  test('are none in a script without markers, and a marker in a cue line is not one', () => {
    expect(checkMarkers('Plain words.')).toEqual([]);
    expect(checkMarkers('[B-ROLL: a sign reading [CHECK: x] | sign | ]')).toEqual([]);
  });
});

describe('syllables, by the stated rule', () => {
  test.each([
    ['cat', 1],
    ['water', 2],
    ['machine', 2],
    ['table', 2],
    ['the', 1],
    ['beautiful', 3],
    ['rhythm', 1],
    ['idea', 2],
    ['1987', 1],
    ['', 0],
  ])('counts %s as %d', (word, syllables) => {
    expect(countSyllables(word)).toBe(syllables);
  });
});

describe('the reading grade', () => {
  const simple = 'The cat sat on the mat. The dog ran to the man. It was a hot day. '.repeat(3);
  const dense =
    'Institutional accountability mechanisms necessitate comprehensive organisational transparency, notwithstanding considerable administrative complications. '.repeat(
      3,
    );

  test('is the Flesch-Kincaid grade: low for short plain sentences, high for long dense ones', () => {
    const low = readingGrade(simple);
    const high = readingGrade(dense);

    expect(low).not.toBeNull();
    expect(low ?? 0).toBeLessThan(2);
    expect(high ?? 0).toBeGreaterThan(18);
  });

  test('follows the formula on a text counted by hand', () => {
    // Eleven words, two sentences, fourteen syllables:
    // 0.39 * (11 / 2) + 11.8 * (14 / 11) - 15.59 = 1.57.
    const text = 'The old machine ran all night. Nobody knew why it ran.';

    expect(readingGrade(text, { minWords: 1 })).toBeCloseTo(1.57, 2);
  });

  test('is not given for text too short to judge, or with no sentence ends, or not in Latin script', () => {
    expect(readingGrade('Too short.')).toBeNull();
    expect(readingGrade('word '.repeat(300))).toBeNull();
    expect(readingGrade('Это предложение написано кириллицей. '.repeat(20))).toBeNull();
    expect(readingGrade('这是一个句子。'.repeat(40))).toBeNull();
  });

  test('ignores cues, markers and headings', () => {
    const marked = `## HOOK\n[B-ROLL: x | y | z]\n${simple.replace('mat.', 'mat [CHECK: the mat].')}`;

    expect(readingGrade(marked)).toBeCloseTo(readingGrade(simple) ?? -1, 5);
  });
});

describe('telling Latin script', () => {
  test('goes by the share of letters, and four in five must be Latin', () => {
    expect(LATIN_MIN_SHARE).toBe(0.8);
    expect(isMostlyLatin('Mostly English with one слово')).toBe(true);
    expect(isMostlyLatin('Половина half')).toBe(false);
    expect(isMostlyLatin('1234 !!')).toBe(false);
  });
});

describe('the typical sentence', () => {
  test('is the median number of words in a sentence', () => {
    expect(sentenceLength('One two three. Four five. Six seven eight nine ten!')).toBe(3);
  });

  test('is unknown for text without sentence ends, such as captions made by listening', () => {
    expect(sentenceLength('word '.repeat(200))).toBeNull();
    expect(sentenceLength('')).toBeNull();
  });
});

describe('picture cues', () => {
  test('are read from their fixed form, with times worked out from the words before each', () => {
    // 14 words are spoken under the first cue and 11 under the second; at 150 a minute the first ends at 5.6 seconds and the second at 10.
    expect(parseCues(SCRIPT, 150)).toEqual([
      {
        show: 'a rusted press in an empty hall',
        search: 'abandoned factory machine',
        sound: 'low hum',
        startSeconds: 0,
        endSeconds: 6,
        words: 14,
      },
      {
        show: 'an old electricity meter spinning',
        search: 'vintage electricity meter',
        sound: '',
        startSeconds: 6,
        endSeconds: 10,
        words: 11,
      },
    ]);
  });

  test('take no time from the model: a time written inside a cue is just words', () => {
    const [cue] = parseCues('[B-ROLL: 0:45 a clock | clock | ]\none two three', 180);

    expect(cue).toMatchObject({ show: '0:45 a clock', startSeconds: 0, endSeconds: 1 });
  });

  test('are none without a rate to time them by, and a line in another form is not a cue', () => {
    expect(parseCues(SCRIPT, 0)).toEqual([]);
    expect(parseCues('B-ROLL: a clock\n[BROLL: a clock]\nwords', 150)).toEqual([]);
  });

  test('a cue with only what to show still counts', () => {
    expect(parseCues('[B-ROLL: a clock]\nwords here', 120)).toEqual([
      { show: 'a clock', search: '', sound: '', startSeconds: 0, endSeconds: 1, words: 2 },
    ]);
  });
});

describe('the shot list as a file', () => {
  test('has a first row of column names and one row per cue, with times as minutes and seconds', () => {
    const csv = shotListCsv(parseCues(SCRIPT, 150));

    expect(csv.split('\r\n')).toEqual([
      'Shot,Starts,Ends,What to show,Search phrase or picture prompt,Sound or music',
      '1,0:00,0:06,a rusted press in an empty hall,abandoned factory machine,low hum',
      '2,0:06,0:10,an old electricity meter spinning,vintage electricity meter,',
      '',
    ]);
  });

  test('quotes commas, quotes and line breaks, and nothing that does not need it', () => {
    expect(toCsv([['plain', 'a, b', 'say "hi"', 'two\nlines', '']])).toBe(
      'plain,"a, b","say ""hi""","two\nlines",\r\n',
    );
  });

  test('keeps a cell that starts like a formula from being run by a spreadsheet', () => {
    expect(toCsv([['=SUM(A1)', '+1', '-2', '@x']])).toBe("'=SUM(A1),'+1,'-2,'@x\r\n");
  });
});

describe('a script without its check markers', () => {
  test('keeps the headings, the cues and the claims, and drops only the markers', () => {
    expect(stripCheckMarkers(SCRIPT)).toBe(
      [
        '## HOOK',
        '[B-ROLL: a rusted press in an empty hall | abandoned factory machine | low hum]',
        'Nobody switched it off. The plant closed in 1987, and the press kept running.',
        '',
        '## BEAT 1: Who paid the bill',
        '[B-ROLL: an old electricity meter spinning | vintage electricity meter | ]',
        'Somebody was paying for the power. That is the first question.',
      ].join('\n'),
    );
  });

  test('leaves a script that has none as it is', () => {
    expect(stripCheckMarkers('## HOOK\nPlain words.')).toBe('## HOOK\nPlain words.');
  });
});
