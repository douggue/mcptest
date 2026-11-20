import { describe, expect, test } from 'vitest';
import {
  ANALYSIS_OPTIONS,
  answerCredit,
  engineSummary,
  readAnswer,
  skippedNotes,
  type EngineStatus,
} from '../src/lib/analyses';
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
  test('asks for one analysis of one channel and returns the text and who gave it', async () => {
    const sent: string[] = [];
    const skipped = [{ engine: 'agy', reason: 'not-installed', message: 'Not installed.' }];
    const api = createApi(async (url, init) => {
      sent.push(`${String(url)} ${String(init?.body)}`);
      return new Response(
        JSON.stringify({
          success: true,
          data: { analysis: 'topics', text: 'Eight ideas.', engine: 'claude', skipped },
          error: null,
        }),
      );
    });

    expect(await api.analyse('topics', 'UCabc')).toEqual({
      text: 'Eight ideas.',
      engine: 'claude',
      skipped,
    });
    expect(sent).toEqual(['/api/analyses {"analysis":"topics","channel":"UCabc"}']);
  });

  test('reads an answer from a server that does not yet say who gave it', async () => {
    const api = createApi(
      async () =>
        new Response(
          JSON.stringify({ success: true, data: { analysis: 'topics', text: 'x' }, error: null }),
        ),
    );

    expect(await api.analyse('topics', 'UCabc')).toEqual({ text: 'x', engine: null, skipped: [] });
  });

  test('passes on the server’s plain message when no engine can run', async () => {
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

const engine = (id: EngineStatus['id'], more: Partial<EngineStatus> = {}): EngineStatus => ({
  id,
  label: id,
  installed: true,
  signedIn: true,
  version: '1.0.0',
  ready: true,
  note: null,
  ...more,
});
const missing = { installed: false, signedIn: null, version: null, ready: false };

describe('the engines call of the API client', () => {
  test('reads which engines are available and the order they are tried in', async () => {
    const report = { engines: [engine('claude')], order: ['agy', 'claude', 'codex'] };
    const asked: string[] = [];
    const api = createApi(async (url) => {
      asked.push(String(url));
      return new Response(JSON.stringify({ success: true, data: report, error: null }));
    });

    expect(await api.engines()).toEqual(report);
    expect(asked).toEqual(['/api/engines']);
  });
});

describe('engineSummary', () => {
  test('says in one line, in the order tried, which engines are ready', () => {
    const report = {
      engines: [
        engine('agy', missing),
        engine('claude'),
        engine('codex', { signedIn: false, ready: false }),
        engine('gemini-api', { ...missing, note: 'Put GEMINI_API_KEY in the .env file.' }),
      ],
      order: ['agy', 'claude', 'codex'] as const,
    };

    expect(engineSummary(report)).toBe(
      'Antigravity: not installed · Claude Code: ready · Codex: not signed in · Gemini API, for watching video: no key',
    );
  });

  test('follows the owner’s order and leaves out engines their settings do', () => {
    const report = {
      engines: [engine('agy'), engine('claude'), engine('codex'), engine('gemini-api')],
      order: ['codex', 'agy'] as const,
    };

    expect(engineSummary(report)).toBe(
      'Codex: ready · Antigravity: ready · Gemini API, for watching video: key set',
    );
  });

  test('says when an installed engine still needs a step from the owner', () => {
    const report = {
      engines: [engine('agy', { signedIn: null, ready: false, note: 'Add a line.' })],
      order: ['agy'] as const,
    };

    expect(engineSummary(report)).toBe('Antigravity: needs setting up');
  });

  test('says nothing before the engines are known', () => {
    expect(engineSummary(null)).toBe('');
  });
});

describe('answerCredit and skippedNotes', () => {
  test('names the engine that answered', () => {
    expect(answerCredit({ text: 'x', engine: 'claude', skipped: [] })).toBe(
      'Answered by Claude Code.',
    );
    expect(answerCredit({ text: 'x', engine: 'agy', skipped: [] })).toBe(
      'Answered by Antigravity.',
    );
  });

  test('says nothing when the server did not say who answered', () => {
    expect(answerCredit({ text: 'x', engine: null, skipped: [] })).toBe('');
  });

  test('says which engines were passed over, each with its reason in plain words', () => {
    const skipped = [
      { engine: 'agy', reason: 'not-signed-in', message: 'Add "mcp(jgtube/*)" to its settings.' },
      { engine: 'claude', reason: 'limit', message: 'You have hit your session limit.' },
    ] as const;

    expect(answerCredit({ text: 'x', engine: 'codex', skipped })).toBe(
      'Answered by Codex. Antigravity and Claude Code were passed over.',
    );
    expect(skippedNotes(skipped)).toEqual([
      'Antigravity: Add "mcp(jgtube/*)" to its settings.',
      'Claude Code: You have hit your session limit.',
    ]);
  });

  test('uses the singular for one engine passed over', () => {
    const skipped = [
      { engine: 'agy', reason: 'not-installed', message: 'Not installed.' },
    ] as const;

    expect(answerCredit({ text: 'x', engine: 'claude', skipped })).toBe(
      'Answered by Claude Code. Antigravity was passed over.',
    );
  });
});
