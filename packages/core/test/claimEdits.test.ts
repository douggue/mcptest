import { describe, expect, test } from 'vitest';
import { acceptClaim, applyCorrection } from '../src/research/claimEdits';
import { checkMarkers, cleanVoiceover } from '../src/script/measure';

const SCRIPT = [
  '## HOOK',
  '[B-ROLL: a plant | plant | none]',
  'It opened in 2019 [CHECK: the year]. It is big [CHECK: its size].',
  'Later it opened in 2019 again [CHECK: the year].',
].join('\n');

describe('accepting a checked claim', () => {
  test('takes away that one marker and leaves the sentence and the others', () => {
    const accepted = acceptClaim(SCRIPT, {
      what: 'the year',
      sentence: 'Later it opened in 2019 again.',
    });

    expect(accepted).toContain('It opened in 2019 [CHECK: the year].');
    expect(accepted).toContain('Later it opened in 2019 again.');
    expect(checkMarkers(accepted)).toHaveLength(2);
  });

  test('changes nothing when the claim is no longer in the script', () => {
    expect(acceptClaim(SCRIPT, { what: 'gone', sentence: 'Gone.' })).toBe(SCRIPT);
  });
});

describe('applying a correction', () => {
  test('puts the corrected sentence in place of the wrong one, with a visible note that is not spoken', () => {
    const fixed = applyCorrection(
      SCRIPT,
      { what: 'the year', sentence: 'It opened in 2019.' },
      'It opened in 2020.',
    );

    expect(fixed).toContain('It opened in 2020. [FIXED: the year] It is big [CHECK: its size].');
    expect(checkMarkers(fixed)).toHaveLength(2);
    expect(cleanVoiceover(fixed)).toContain('It opened in 2020. It is big.');
  });

  test('ends a correction with a full stop when it has none', () => {
    const fixed = applyCorrection(
      SCRIPT,
      { what: 'its size', sentence: 'It is big.' },
      'It is small',
    );

    expect(fixed).toContain('It is small. [FIXED: its size]');
  });
});
