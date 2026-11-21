import { markerLines } from '@jgtube/core';
import { describe, expect, test } from 'vitest';
import { pictureQuestion, planQuestion } from '../src/breakdownPartQuestions';

const CHANNEL = 'UCHnyfMqiRRG1u-2MsSQLbXA';
const focus = {
  top: ['aaaaaaaaaa1', 'aaaaaaaaaa2'],
  deep: ['aaaaaaaaaa1', 'aaaaaaaaaa2'],
  titles: ['aaaaaaaaaa1', 'aaaaaaaaaa2'],
  ordinary: [],
  storedVideos: 2,
};
const { start, end } = markerLines('STYLE LOCK');

describe('the picture part and a consistent picture style', () => {
  const question = pictureQuestion(CHANNEL, focus);

  test('describes the style in detail only when the frame studies show one, and invents none', () => {
    expect(question).toContain('PICTURE STYLE');
    for (const aspect of [
      'medium',
      'line',
      'palette',
      'lighting',
      'composition',
      'on-screen text',
    ]) {
      expect(question).toContain(aspect);
    }
    expect(question).toMatch(/each colour named/);
    expect(question).toMatch(/what never appears/);
    expect(question).toContain('NO CONSISTENT STYLE');
    expect(question).toMatch(/make none up/);
  });

  test('sets the style lock out between its marker lines, and writes none without a style', () => {
    expect(question).toContain(start);
    expect(question).toContain(end);
    expect(question).toContain('STYLE BLOCK');
    expect(question).toContain('NEGATIVE');
    expect(question).toMatch(/style reference image/);
    expect(question).toMatch(/seed/);
    expect(question).toMatch(/character sheet/);
    expect(question).toMatch(/only as an example/);
    expect(question).toMatch(/write no marker lines/);
  });
});

describe('the production plan and the style lock', () => {
  test('builds the scene prompts on the picture part’s style lock, or says there is none', () => {
    const question = planQuestion(CHANNEL, focus);

    expect(question).toMatch(/STYLE LOCK/);
    expect(question).toMatch(/style block word for word/);
    expect(question).toMatch(/NO CONSISTENT STYLE/);
  });
});
