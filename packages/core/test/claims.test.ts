import { describe, expect, test } from 'vitest';
import { MAX_CLAIMS_PER_RUN, claimsToCheck, parseClaimVerdicts } from '../src/research/claims';

describe('the claims a script still marks to check', () => {
  test('are each marker once, with the sentence it stands in', () => {
    const script = [
      '## HOOK',
      '[B-ROLL: a plant | plant | none]',
      'It opened in 2019 [CHECK: the year it opened]. It is big [CHECK: its size].',
      'Again it opened in 2019 [CHECK: the year it opened].',
    ].join('\n');

    expect(claimsToCheck(script)).toEqual([
      { what: 'the year it opened', sentence: 'It opened in 2019.' },
      { what: 'its size', sentence: 'It is big.' },
      { what: 'the year it opened', sentence: 'Again it opened in 2019.' },
    ]);
    expect(MAX_CLAIMS_PER_RUN).toBe(10);
  });
});

describe('the verdicts of a claims check', () => {
  const answer = [
    'CLAIM 1: CONFIRMED',
    'WHY: The operator says it opened in 2019.',
    'SOURCE: https://operator.example/history',
    'CLAIM 2: WRONG',
    'WHY: It opened in 2020, not 2019.',
    'CORRECTION: It opened in 2020.',
    'SOURCE: https://news.example/opening',
    'CLAIM 3: CONFIRMED',
    'WHY: I am fairly sure.',
    'CLAIM 4: WRONG',
    'WHY: Wrong year.',
    'SOURCE: https://x.example/y',
    'CLAIM 9: CONFIRMED',
    'SOURCE: https://x.example/z',
  ].join('\n');

  test('are read per claim with their sentence, correction and https sources', () => {
    const verdicts = parseClaimVerdicts(answer, 4);

    expect(verdicts[0]).toEqual({
      index: 1,
      verdict: 'confirmed',
      why: 'The operator says it opened in 2019.',
      correction: null,
      sources: ['https://operator.example/history'],
    });
    expect(verdicts[1]).toMatchObject({
      verdict: 'wrong',
      correction: 'It opened in 2020.',
      sources: ['https://news.example/opening'],
    });
  });

  test('never count as confirmed or wrong without a source, or wrong without a correction', () => {
    const verdicts = parseClaimVerdicts(answer, 4);

    expect(verdicts[2]).toMatchObject({ index: 3, verdict: 'unsure' });
    expect(verdicts[3]).toMatchObject({ index: 4, verdict: 'unsure' });
  });

  test('ignore a claim number that was not asked, and give unsure for one not answered', () => {
    const verdicts = parseClaimVerdicts('CLAIM 1: CONFIRMED\nSOURCE: https://a.example/b', 2);

    expect(verdicts.map((one) => one.index)).toEqual([1, 2]);
    expect(verdicts[1]).toMatchObject({
      verdict: 'unsure',
      why: 'The check gave no answer for it.',
    });
  });
});
