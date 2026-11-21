import { describe, expect, test } from 'vitest';
import {
  ANALYSIS_OPTIONS,
  AUTOMATIC,
  ENGINE_CHOICES,
  answerCredit,
  choiceFor,
  choiceFrom,
  choiceHelp,
  engineSummary,
  keptLine,
  keptOnly,
  latestKept,
  readAnswer,
  readSections,
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
      { kind: 'field', label: 'TITLE', text: 'America’s New Material' },
    ]);
  });

  test('strips stray markdown marks instead of showing them', () => {
    expect(readAnswer('## KEEP\n* **INGENIUM**: same videos\n`code`')).toEqual([
      { kind: 'heading', text: 'KEEP' },
      { kind: 'field', label: 'INGENIUM', text: 'same videos' },
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
      prompt: null,
      videos: [],
      writtenAt: null,
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

    expect(await api.analyse('topics', 'UCabc')).toEqual({
      text: 'x',
      engine: null,
      skipped: [],
      prompt: null,
      videos: [],
      writtenAt: null,
    });
  });

  test('reads the ready prompt and the named videos a thumbnail review comes with', async () => {
    const videos = [
      {
        videoId: 'aaaaaaaaaa1',
        title: 'T',
        channelId: 'UCaaaaaaaaaaaaaaaaaaaaaa',
        channelTitle: 'A',
        views: 5,
      },
    ];
    const api = createApi(
      async () =>
        new Response(
          JSON.stringify({
            success: true,
            data: {
              analysis: 'thumbnails',
              text: 'x',
              engine: 'claude',
              skipped: [],
              prompt: 'A wide photo of [SUBJECT].',
              videos,
              writtenAt: '2026-11-20T12:00:00.000Z',
            },
            error: null,
          }),
        ),
    );

    expect(await api.analyse('thumbnails', 'UCabc')).toMatchObject({
      prompt: 'A wide photo of [SUBJECT].',
      videos,
      writtenAt: '2026-11-20T12:00:00.000Z',
    });
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
    expect(answerCredit({ engine: 'claude', skipped: [] })).toBe('Answered by Claude Code.');
    expect(answerCredit({ engine: 'agy', skipped: [] })).toBe('Answered by Antigravity.');
  });

  test('says nothing when the server did not say who answered', () => {
    expect(answerCredit({ engine: null, skipped: [] })).toBe('');
  });

  test('says which engines were passed over, each with its reason in plain words', () => {
    const skipped = [
      { engine: 'agy', reason: 'not-signed-in', message: 'Add "mcp(jgtube/*)" to its settings.' },
      { engine: 'claude', reason: 'limit', message: 'You have hit your session limit.' },
    ] as const;

    expect(answerCredit({ engine: 'codex', skipped })).toBe(
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

    expect(answerCredit({ engine: 'claude', skipped })).toBe(
      'Answered by Claude Code. Antigravity was passed over.',
    );
  });
});

describe('the switch for which AI answers', () => {
  const report = {
    engines: [engine('agy', missing), engine('claude'), engine('codex')],
    order: ['claude', 'agy', 'codex'] as const,
  };

  test('offers Automatic first, then each engine by the name a creator knows', () => {
    expect(ENGINE_CHOICES.map((option) => [option.choice, option.label])).toEqual([
      ['auto', 'Automatic'],
      ['claude', 'Claude Code'],
      ['agy', 'Antigravity'],
      ['codex', 'Codex'],
    ]);
  });

  test('reads a remembered choice back, and anything else as Automatic', () => {
    expect(choiceFrom('codex')).toBe('codex');
    expect(choiceFrom(null)).toBe(AUTOMATIC);
    expect(choiceFrom('gpt')).toBe(AUTOMATIC);
  });

  test('Automatic names the main engine and its backups in order', () => {
    expect(choiceHelp(AUTOMATIC, report)).toBe(
      'Claude Code answers. If it cannot, Antigravity and then Codex are tried.',
    );
    expect(choiceHelp(AUTOMATIC, { engines: [], order: ['claude', 'codex'] })).toBe(
      'Claude Code answers. If it cannot, Codex is tried.',
    );
    expect(choiceHelp(AUTOMATIC, { engines: [], order: ['claude'] })).toBe('Claude Code answers.');
    expect(choiceHelp(AUTOMATIC, null)).toMatch(/Jgtube picks the AI/);
  });

  test('a chosen engine answers alone, and says what is in the way when it is not usable', () => {
    expect(choiceHelp('codex', report)).toBe(
      'Only Codex answers; nothing else is tried if it cannot.',
    );
    expect(choiceHelp('agy', report)).toBe('Antigravity is not installed on this computer.');
    expect(choiceHelp('agy', { ...report, engines: [engine('agy')] })).toMatch(
      /thumbnail review needs Claude Code or Codex until Antigravity passes the picture check/,
    );
    expect(choiceHelp('codex', { engines: [], order: ['claude'] })).toMatch(/switched off/);
    expect(choiceHelp('claude', null)).toMatch(/^Only Claude Code answers/);
  });

  test('the API client names the chosen engine, and names none for Automatic', async () => {
    const sent: string[] = [];
    const api = createApi(async (_url, init) => {
      sent.push(String(init?.body));
      return new Response(JSON.stringify({ success: true, data: { text: 'x' }, error: null }));
    });

    await api.analyse('topics', 'UCabc', 'codex');
    await api.analyse('topics', 'UCabc', AUTOMATIC);

    expect(sent).toEqual([
      '{"analysis":"topics","channel":"UCabc","engine":"codex"}',
      '{"analysis":"topics","channel":"UCabc"}',
    ]);
  });
});

describe('an answer made of labelled lines', () => {
  const idea = [
    'Two were skipped as already made.',
    '',
    '1. NEW METAL',
    'SOURCE: TRANSFER. Germany, 941,000 views.',
    'TITLE: A New Alloy / The Metal That Rewrites The Textbook',
    'WHY: One channel, 941,000 views.',
    'PROOF AT YOUR SIZE: A channel with 9,240 subs.',
    '',
    '2. NEW PLANE',
    'SOURCE: BREAKOUT',
    'It went on: a second line of the same thought.',
  ].join('\n');

  test('keeps each labelled line as its own field instead of running them together', () => {
    expect(readAnswer(idea).slice(1, 6)).toEqual([
      { kind: 'heading', text: '1. NEW METAL' },
      { kind: 'field', label: 'SOURCE', text: 'TRANSFER. Germany, 941,000 views.' },
      { kind: 'field', label: 'TITLE', text: 'A New Alloy / The Metal That Rewrites The Textbook' },
      { kind: 'field', label: 'WHY', text: 'One channel, 941,000 views.' },
      { kind: 'field', label: 'PROOF AT YOUR SIZE', text: 'A channel with 9,240 subs.' },
    ]);
  });

  test('a line in capitals that ends in a colon is still a heading, and prose with a colon is prose', () => {
    expect(readAnswer('WINNING STYLES:\nNote: this one is small.')).toEqual([
      { kind: 'heading', text: 'WINNING STYLES:' },
      { kind: 'paragraph', text: 'Note: this one is small.' },
    ]);
  });

  test('groups the blocks under their headings, and marks numbered headings as entries', () => {
    const sections = readSections(idea);

    expect(
      sections.map((section) => [section.title, section.numbered, section.blocks.length]),
    ).toEqual([
      [null, false, 1],
      ['1. NEW METAL', true, 4],
      ['2. NEW PLANE', true, 2],
    ]);
    expect(sections[2]?.blocks).toEqual([
      { kind: 'field', label: 'SOURCE', text: 'BREAKOUT' },
      { kind: 'paragraph', text: 'It went on: a second line of the same thought.' },
    ]);
  });

  test('an answer with no headings is one untitled section, and an empty answer is none', () => {
    expect(readSections('Just a sentence.')).toEqual([
      { title: null, numbered: false, blocks: [{ kind: 'paragraph', text: 'Just a sentence.' }] },
    ]);
    expect(readSections('')).toEqual([]);
  });
});

describe('the answer shown when nothing has been asked yet', () => {
  const kept = (writtenAt: string | null) => ({
    text: writtenAt ?? 'none',
    engine: 'claude' as const,
    skipped: [],
    prompt: null,
    videos: [],
    writtenAt,
  });

  test('is the one kept most recently for the channel', () => {
    const latest = latestKept([
      { analysis: 'thumbnails', answer: kept('2026-11-01T00:00:00Z') },
      { analysis: 'topics', answer: kept('2026-11-03T00:00:00Z') },
      { analysis: 'near-misses', answer: null },
    ]);

    expect(latest?.analysis).toBe('topics');
  });

  test('is none when nothing is kept', () => {
    expect(latestKept([{ analysis: 'topics', answer: null }])).toBeNull();
    expect(latestKept([{ analysis: 'topics', answer: kept(null) }])).toBeNull();
  });
});

describe('keptOnly', () => {
  test('keeps each analysis that has an answer, in order', () => {
    const answer = {
      text: 'x',
      prompt: null,
      videos: [],
      engine: null,
      skipped: [],
      writtenAt: null,
    };
    const entries = keptOnly([
      { analysis: 'thumbnails', answer: null },
      { analysis: 'topics', answer },
    ]);
    expect(entries).toEqual([{ analysis: 'topics', answer }]);
  });
});

describe('the line saying when a kept answer was written', () => {
  test('names the day, and is empty when the time is unknown', () => {
    expect(keptLine('2026-11-20T12:00:00Z', () => '20 Nov')).toBe('Kept from 20 Nov.');
    expect(keptLine(null)).toBe('');
    expect(keptLine('not a time')).toBe('');
  });
});

describe('a question the chosen AI cannot answer', () => {
  test('sends a thumbnail review chosen for Antigravity to Automatic, and says so', () => {
    const plan = choiceFor('thumbnails', 'agy');

    expect(plan.choice).toBe(AUTOMATIC);
    expect(plan.note).toMatch(/Antigravity has not passed the picture check yet/);
    expect(plan.note).toMatch(/Claude Code, or else Codex/);
  });

  test('keeps the chosen AI when it can answer', () => {
    expect(choiceFor('thumbnails', 'claude')).toEqual({ choice: 'claude', note: null });
    expect(choiceFor('thumbnails', 'codex')).toEqual({ choice: 'codex', note: null });
    expect(choiceFor('topics', 'agy')).toEqual({ choice: 'agy', note: null });
    expect(choiceFor('thumbnails', AUTOMATIC)).toEqual({ choice: AUTOMATIC, note: null });
  });
});
