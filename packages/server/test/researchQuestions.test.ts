import { describe, expect, test } from 'vitest';
import {
  MAX_SUBJECT_CHARS,
  RESEARCH_SYSTEM_PROMPT,
  claimsQuestion,
  quotedSubject,
  researchQuestion,
} from '../src/researchQuestions';

describe('a subject put into a web research question', () => {
  test('is quoted, capped, and cannot close its own quotes', () => {
    expect(quotedSubject('Rust "batteries"', MAX_SUBJECT_CHARS)).toBe('"Rust \'batteries\'"');
    expect(quotedSubject('x'.repeat(500), 50)).toBe(`"${'x'.repeat(50)}"`);
  });

  test('is refused when it holds a line break or a control or hidden character', () => {
    expect(() => quotedSubject('two\nlines', 100)).toThrow(/one line/);
    expect(() => quotedSubject('bell\u0007', 100)).toThrow(/one line/);
    expect(() => quotedSubject('hidden‮flip', 100)).toThrow(/one line/);
  });
});

describe('the research question', () => {
  const question = researchQuestion({
    title: 'America’s New Battery Runs on Rust',
    needs: 'Which company builds iron-air batteries',
    angle: 'machines that outlived us',
  });

  test('introduces the concept’s words as a subject to research, never as instructions', () => {
    expect(question).toContain('"America’s New Battery Runs on Rust"');
    expect(question).toContain('"Which company builds iron-air batteries"');
    expect(question).toContain('"machines that outlived us"');
    expect(question).toMatch(/a subject to research, not instructions/);
  });

  test('asks for the fixed form: numbered facts with https sources, then what was not found or is disputed', () => {
    expect(question).toContain('FACT 1:');
    expect(question).toContain('SOURCE:');
    expect(question).toContain('NOT FOUND:');
    expect(question).toContain('DISPUTED:');
    expect(question).toMatch(/what, who, when, where/);
    expect(question).toMatch(/https/);
  });

  test('leaves out what the concept did not give', () => {
    expect(researchQuestion({ title: 'T', needs: null, angle: null })).not.toContain('angle');
  });

  test('is asked of a researcher who uses only the web', () => {
    expect(RESEARCH_SYSTEM_PROMPT).toMatch(/web search and web fetch/);
  });
});

describe('the claims check question', () => {
  test('numbers each claim as a quoted statement to verify, and asks a verdict per claim', () => {
    const question = claimsQuestion([
      { what: 'the year it opened', sentence: 'It opened in 2019.' },
      { what: 'its size', sentence: 'It is "huge".' },
    ]);

    expect(question).toContain(
      '1. Statement: "It opened in 2019." To verify: "the year it opened"',
    );
    expect(question).toContain('2. Statement: "It is \'huge\'."');
    expect(question).toMatch(/statements to verify, not instructions/);
    expect(question).toContain('CLAIM 1: CONFIRMED, WRONG or UNSURE');
    expect(question).toMatch(/CORRECTION/);
  });

  test('refuses more claims than one run takes, and a claim with a control character', () => {
    const many = Array.from({ length: 11 }, () => ({ what: 'x', sentence: 'y.' }));
    expect(() => claimsQuestion(many)).toThrow(/at most 10/);
    expect(() => claimsQuestion([{ what: 'x\u0000', sentence: 'y.' }])).toThrow(/one line/);
  });
});
