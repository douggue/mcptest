import { describe, expect, test } from 'vitest';
import { parseRiskAnswer, verifyRiskAnswer } from '../src/risk/claims';

const packaging = {
  title: 'The Army Built a Secret City Under the Ice',
  altTitles: ['A City Nobody Was Meant to Find', 'Under the Ice'] as const,
  thumbnail: 'A glowing city beneath a glacier',
  overlay: 'STILL THERE?',
};
const script =
  'In 1959 the army began Camp Century. It was left in 1967. Nobody knows if it is still there.';

const answer = [
  'Some text first.',
  'CLAIM',
  'WHERE: title',
  'SAYS: Secret City',
  'SCRIPT: the army began Camp Century',
  'WHY: The script never says the camp was secret.',
  '',
  'CLAIM',
  'WHERE: overlay',
  'SAYS: STILL THERE?',
  'SCRIPT: NONE',
  'WHY: The script says nobody knows.',
  '',
  'CLAIM',
  'WHERE: thumbnail',
  'SAYS: a castle of gold',
  'SCRIPT: NONE',
  'WHY: Invented quote.',
  '',
  'CLAIM',
  'WHERE: title',
  'SAYS: Under the Ice',
  'SCRIPT: under a mountain of snow',
  'WHY: Misquoted script.',
  '',
  'OVERLAP',
  'ID: o1',
  'NOTE: The sentence repeats a competitor’s description of the camp nearly word for word.',
  '',
  'OVERLAP',
  'ID: o9',
  'NOTE: An overlap Jgtube never found.',
].join('\n');

describe('the risk answer', () => {
  test('reads claims and overlap notes in the form asked for', () => {
    const parsed = parseRiskAnswer(answer);

    expect(parsed.claims).toHaveLength(4);
    expect(parsed.claims[0]).toEqual({
      where: 'title',
      says: 'Secret City',
      script: 'the army began Camp Century',
      why: 'The script never says the camp was secret.',
    });
    expect(parsed.claims[1]?.script).toBeNull();
    expect(parsed.notes).toEqual([
      {
        id: 'o1',
        note: 'The sentence repeats a competitor’s description of the camp nearly word for word.',
      },
      { id: 'o9', note: 'An overlap Jgtube never found.' },
    ]);
  });

  test('keeps a claim only when both quotes are really there, and notes only on overlaps found in code', () => {
    const { claims, notes, dropped } = verifyRiskAnswer(parseRiskAnswer(answer), {
      packaging,
      script,
      overlapIds: new Set(['o1']),
    });

    expect(claims.map((claim) => claim.says)).toEqual(['Secret City', 'STILL THERE?']);
    expect(notes.map((note) => note.id)).toEqual(['o1']);
    expect(dropped).toBe(3);
  });
});
