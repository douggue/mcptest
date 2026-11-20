import { describe, expect, test } from 'vitest';
import { ANALYSIS_OPTIONS, readAnswer } from '../src/lib/analyses';
import { createApi } from '../src/lib/api';

describe('the analyses the screen offers', () => {
  test('are the three the server knows, each with a title, a sentence and a button label', () => {
    expect(ANALYSIS_OPTIONS.map((option) => option.id)).toEqual([
      'thumbnails',
      'topics',
      'near-misses',
    ]);
    for (const option of ANALYSIS_OPTIONS) {
      expect(option.title.length).toBeGreaterThan(3);
      expect(option.description.length).toBeGreaterThan(20);
      expect(option.action.length).toBeGreaterThan(3);
    }
  });
});

describe('readAnswer', () => {
  test('splits an answer into headings, list items and paragraphs', () => {
    const answer = [
      'WHAT THE WINNERS DO',
      '- The invention fills the frame.',
      '- The text names the thing.',
      '',
      'A closing thought that runs',
      'over two lines.',
      '',
      '1. CARBON FIBER REPLACEMENT',
      '- TITLE: America’s New Material',
    ].join('\n');

    expect(readAnswer(answer)).toEqual([
      { kind: 'heading', text: 'WHAT THE WINNERS DO' },
      { kind: 'item', text: 'The invention fills the frame.' },
      { kind: 'item', text: 'The text names the thing.' },
      { kind: 'paragraph', text: 'A closing thought that runs over two lines.' },
      { kind: 'heading', text: '1. CARBON FIBER REPLACEMENT' },
      { kind: 'item', text: 'TITLE: America’s New Material' },
    ]);
  });

  test('strips stray markdown marks instead of showing them', () => {
    expect(readAnswer('## KEEP\n* **INGENIUM**: same videos\n`code`')).toEqual([
      { kind: 'heading', text: 'KEEP' },
      { kind: 'item', text: 'INGENIUM: same videos' },
      { kind: 'paragraph', text: 'code' },
    ]);
  });

  test('does not take a short shouted sentence in a paragraph for a heading', () => {
    expect(readAnswer('Use "CHINA SHOCKED!" less often.')).toEqual([
      { kind: 'paragraph', text: 'Use "CHINA SHOCKED!" less often.' },
    ]);
  });

  test('gives nothing for an empty answer', () => {
    expect(readAnswer('  \n\n ')).toEqual([]);
  });
});

describe('the analysis call of the API client', () => {
  test('asks for one analysis of one channel and returns the text', async () => {
    const sent: string[] = [];
    const api = createApi(async (url, init) => {
      sent.push(`${String(url)} ${String(init?.body)}`);
      return new Response(
        JSON.stringify({
          success: true,
          data: { analysis: 'topics', text: 'Eight ideas.' },
          error: null,
        }),
      );
    });

    expect(await api.analyse('topics', 'UCabc')).toBe('Eight ideas.');
    expect(sent).toEqual(['/api/analyses {"analysis":"topics","channel":"UCabc"}']);
  });

  test('passes on the server’s plain message when Claude cannot run', async () => {
    const api = createApi(
      async () =>
        new Response(
          JSON.stringify({ success: false, data: null, error: 'Claude Code is not installed.' }),
          { status: 503 },
        ),
    );

    await expect(api.analyse('topics', 'UCabc')).rejects.toThrow('Claude Code is not installed.');
  });
});
