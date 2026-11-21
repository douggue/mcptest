import { describe, expect, test } from 'vitest';
import { EngineRunError } from '../../src/engines/failure';
import {
  helperLines,
  parseEnginesArgs,
  planTrials,
  reportLines,
  runTrials,
  videoIdOf,
  type TrialActions,
} from '../../src/engines/report';
import type { EngineStatus } from '../../src/engines/types';

const status = (
  id: EngineStatus['id'],
  label: string,
  more: Partial<EngineStatus> = {},
): EngineStatus => ({
  id,
  label,
  installed: true,
  signedIn: true,
  version: '1.2.3',
  ready: true,
  note: null,
  ...more,
});

const agy = status('agy', 'Antigravity CLI', { signedIn: null, version: '1.5.12' });
const claude = status('claude', 'Claude Code', { version: '2.1.330' });
const codexMissing = status('codex', 'Codex CLI', {
  installed: false,
  signedIn: null,
  version: null,
  ready: false,
});
const geminiNoKey = status('gemini-api', 'Gemini API', {
  installed: false,
  signedIn: null,
  version: null,
  ready: false,
  note: 'Put GEMINI_API_KEY in the .env file to let Gemini watch videos.',
});
const geminiWithKey = status('gemini-api', 'Gemini API', {
  signedIn: null,
  version: null,
  note: 'Watches public YouTube videos with the model gemini-4-hydrogen.',
});
const order = ['agy', 'claude', 'codex'] as const;

describe('parseEnginesArgs', () => {
  test('only reports unless asked to try', () => {
    expect(parseEnginesArgs([])).toEqual({
      try: false,
      video: null,
      youtube: null,
      allowAntigravity: false,
    });
    expect(parseEnginesArgs(['--try'])).toEqual({
      try: true,
      video: null,
      youtube: null,
      allowAntigravity: false,
    });
  });

  test('takes a video file and a YouTube link to try', () => {
    expect(
      parseEnginesArgs(['--try', '--video', 'C:\\clips\\tiny.mp4', '--youtube', 'dQw4w9WgXcQ']),
    ).toEqual({
      try: true,
      video: 'C:\\clips\\tiny.mp4',
      youtube: 'dQw4w9WgXcQ',
      allowAntigravity: false,
    });
  });

  test.each([
    [['--video'], /--video needs/],
    [['--try', '--youtube'], /--youtube needs/],
    [['--video', 'x.mp4'], /only with --try/],
    [['--try', '--youtube', 'https://example.com/watch?v=dQw4w9WgXcQ'], /YouTube link/],
    [['--trie'], /--trie/],
  ])('refuses %j with a plain reason', (argv, reason) => {
    expect(() => parseEnginesArgs(argv)).toThrow(reason);
  });
});

describe('videoIdOf', () => {
  test.each([
    'dQw4w9WgXcQ',
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://youtube.com/watch?v=dQw4w9WgXcQ&t=10s',
    'https://m.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://youtu.be/dQw4w9WgXcQ?si=abc',
    'https://www.youtube.com/shorts/dQw4w9WgXcQ',
  ])('reads the id out of %s', (link) => {
    expect(videoIdOf(link)).toBe('dQw4w9WgXcQ');
  });

  test.each([
    '',
    'not a link',
    'https://example.com/watch?v=dQw4w9WgXcQ',
    'https://www.youtube.com/watch?v=short',
    'https://www.youtube.com/@channel',
    'http://www.youtube.com/watch?v=dQw4w9WgXcQ',
  ])('gives nothing for %j', (link) => {
    expect(videoIdOf(link)).toBeNull();
  });
});

describe('reportLines', () => {
  test('says, for each engine, whether it is installed and signed in, in the order tried', () => {
    expect(reportLines({ engines: [agy, claude, codexMissing, geminiNoKey], order })).toEqual([
      'AI engines on this computer (tried in this order: agy, claude, codex)',
      '  Antigravity CLI (agy): installed, version 1.5.12, sign-in is only known once it is used',
      '  Claude Code (claude): installed, version 2.1.330, signed in',
      '  Codex CLI (codex): not installed',
      '  Gemini API (gemini-api): no key set. Put GEMINI_API_KEY in the .env file to let Gemini watch videos.',
    ]);
  });

  test('says when nobody is signed in, when the version is unknown, and adds what needs doing', () => {
    const lines = reportLines({
      engines: [
        status('codex', 'Codex CLI', { signedIn: false, ready: false }),
        status('agy', 'Antigravity CLI', {
          signedIn: null,
          version: null,
          ready: false,
          note: 'Add the line.',
        }),
        geminiWithKey,
      ],
      order: ['codex'],
    });

    expect(lines.slice(1)).toEqual([
      '  Codex CLI (codex): installed, version 1.2.3, nobody is signed in',
      '  Antigravity CLI (agy): installed, sign-in is only known once it is used. Add the line.',
      '  Gemini API (gemini-api): key set. Watches public YouTube videos with the model gemini-4-hydrogen.',
    ]);
  });
});

describe('helperLines', () => {
  test('says both helper programs are found when they are, and nothing more', () => {
    expect(helperLines({ ytDlp: '/usr/bin/yt-dlp', ffmpeg: '/usr/bin/ffmpeg' })).toEqual([
      'Helper programs for a deep channel breakdown',
      'yt-dlp: found at /usr/bin/yt-dlp. Downloads a video so that it can be watched and its frames cut.',
      'ffmpeg: found at /usr/bin/ffmpeg. Cuts one frame a second from a video file.',
    ]);
  });

  test('says which is missing, and that a breakdown still runs without it', () => {
    const lines = helperLines({ ytDlp: null, ffmpeg: '/usr/bin/ffmpeg' });

    expect(lines[1]).toMatch(/^yt-dlp: not found\./);
    expect(lines[2]).toMatch(/^ffmpeg: found at /);
    expect(lines.join(' ')).toMatch(/JGTUBE_YT_DLP_PATH=/);
    expect(lines.join(' ')).not.toMatch(/JGTUBE_FFMPEG_PATH/);
    expect(lines.at(-1)).toBe(
      'Without them a breakdown still runs, on YouTube’s own preview frames.',
    );
  });
});

describe('planTrials and runTrials', () => {
  /** Actions that answer with their own name, and remember what they were asked. */
  function actions(fail: Partial<Record<string, EngineRunError>> = {}) {
    const asked: string[] = [];
    const answer = (name: string) => async () => {
      asked.push(name);
      const failure = fail[name];
      if (failure) throw failure;
      return { text: `answer from ${name}\nsecond line`, turns: null };
    };
    const all: TrialActions = {
      ask: (id) => answer(id)(),
      askGemini: answer('gemini-api'),
      watchFile: (path) => answer(`file ${path}`)(),
      watchLink: (videoId) => answer(`link ${videoId}`)(),
    };
    return { asked, all };
  }

  const tried = async (
    command: Parameters<typeof planTrials>[0],
    engines: readonly EngineStatus[],
    made = actions(),
  ) => {
    const printed: string[] = [];
    await runTrials(planTrials(command, { engines, order }, made.all), (line) =>
      printed.push(line),
    );
    return { printed, asked: made.asked };
  };

  test('tries each installed engine in order, and says which were left alone and why', async () => {
    const { printed, asked } = await tried(
      { try: true, video: null, youtube: null, allowAntigravity: false },
      [agy, claude, codexMissing, geminiNoKey],
    );

    expect(asked).toEqual(['agy', 'claude']);
    expect(printed).toEqual([
      '',
      'Trying Antigravity CLI with one question that needs one Jgtube tool...',
      '  It answered: answer from agy',
      '    second line',
      'Trying Claude Code with one question that needs one Jgtube tool...',
      '  It answered: answer from claude',
      '    second line',
      'Not trying Codex CLI: not installed.',
      'Not trying Gemini API: no key set.',
    ]);
  });

  test('does not try an engine nobody is signed in to', async () => {
    const signedOut = status('claude', 'Claude Code', { signedIn: false, ready: false });
    const { printed, asked } = await tried(
      { try: true, video: null, youtube: null, allowAntigravity: false },
      [signedOut],
    );

    expect(asked).toEqual([]);
    expect(printed).toContain('Not trying Claude Code: nobody is signed in.');
  });

  test('prints a failure with its kind and goes on to the next engine', async () => {
    const made = actions({
      agy: new EngineRunError('not-signed-in', 'Add "mcp(jgtube/*)" to its settings.'),
    });
    const { printed, asked } = await tried(
      { try: true, video: null, youtube: null, allowAntigravity: false },
      [agy, claude],
      made,
    );

    expect(asked).toEqual(['agy', 'claude']);
    expect(printed).toContain('  It failed (not-signed-in): Add "mcp(jgtube/*)" to its settings.');
    expect(printed).toContain('  It answered: answer from claude');
  });

  test('asks Gemini one question in words when a key is set', async () => {
    const { printed, asked } = await tried(
      { try: true, video: null, youtube: null, allowAntigravity: false },
      [geminiWithKey],
    );

    expect(asked).toEqual(['gemini-api']);
    expect(printed).toContain(
      'Trying Gemini API with one question in words, to prove the key works...',
    );
  });

  test('has Antigravity watch the file and the link it was given, when it is installed', async () => {
    const { printed, asked } = await tried(
      { try: true, video: 'tiny.mp4', youtube: 'dQw4w9WgXcQ', allowAntigravity: false },
      [agy],
    );

    expect(asked).toEqual(['agy', 'file tiny.mp4', 'link dQw4w9WgXcQ']);
    expect(printed).toContain('Trying Antigravity CLI on the video file...');
    expect(printed.join('\n')).toMatch(
      /Trying Antigravity CLI on the YouTube link alone\. If the answer does not match the video, links do not work/,
    );
  });

  test('says it cannot try video without Antigravity', async () => {
    const missing = status('agy', 'Antigravity CLI', { installed: false, ready: false });
    const { printed, asked } = await tried(
      { try: true, video: 'tiny.mp4', youtube: 'dQw4w9WgXcQ', allowAntigravity: false },
      [missing],
    );

    expect(asked).toEqual([]);
    expect(printed.filter((line) => /video|link/.test(line))).toEqual([
      'Not trying the video file: Antigravity CLI is not installed.',
      'Not trying the YouTube link: Antigravity CLI is not installed.',
    ]);
  });

  test('reports an unexpected error in plain words, without file paths', async () => {
    const made = actions();
    made.all.ask = async () => {
      throw new Error('boom at /home/someone/x.ts');
    };
    const { printed } = await tried(
      { try: true, video: null, youtube: null, allowAntigravity: false },
      [claude],
      made,
    );

    expect(printed.join('\n')).toMatch(/It failed \(failed\): boom at <path>/);
  });

  test('plans nothing when not asked to try', () => {
    const { all } = actions();

    expect(
      planTrials(
        { try: false, video: null, youtube: null, allowAntigravity: false },
        { engines: [claude], order },
        all,
      ),
    ).toEqual([]);
  });
});

describe('the option that sets Antigravity up', () => {
  test('is read on its own, and refused together with the trial options', () => {
    expect(parseEnginesArgs(['--allow-antigravity'])).toMatchObject({
      allowAntigravity: true,
      try: false,
    });
    expect(parseEnginesArgs([])).toMatchObject({ allowAntigravity: false });
    expect(() => parseEnginesArgs(['--allow-antigravity', '--try'])).toThrow(/on its own/);
  });
});
