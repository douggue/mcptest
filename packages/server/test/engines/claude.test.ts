import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { buildClaudeArgs, claudeEngine, runClaude } from '../../src/engines/claude';
import { EngineRunError } from '../../src/engines/failure';
import type { EngineDeps, EngineRunRequest } from '../../src/engines/types';
import { harness as standIn, scripted, wait } from './standIn';

const request: EngineRunRequest = {
  prompt: 'Compare my thumbnails with the winners.',
  systemPrompt: 'You are a YouTube analyst.',
  mcpServers: {
    jgtube: { command: 'node', args: ['/app/mcp.js'], env: { JGTUBE_DB_PATH: 'x.db' } },
  },
  allowedTools: ['mcp__jgtube__get_map', 'mcp__jgtube__view_thumbnails'],
  maxTurns: 12,
  timeoutMs: 1000,
  cwd: '/tmp/work',
};

function harness(env: Record<string, string | undefined> = { PATH: '/bin' }) {
  const { child, started, deps } = standIn(env);
  return {
    child,
    started,
    run: (r = request, more: Partial<EngineDeps> = {}) => runClaude(r, { ...deps, ...more }),
  };
}

/** What Claude Code really printed, saved from a run and trimmed of its timing fields. */
const fixture = (name: string): Buffer =>
  readFileSync(fileURLToPath(new URL(`../fixtures/${name}.json`, import.meta.url)));

const success = (result: string) => ({
  type: 'result',
  subtype: 'success',
  is_error: false,
  result,
  num_turns: 3,
});

const valueAfter = (args: readonly string[], flag: string) => args[args.indexOf(flag) + 1];

describe('buildClaudeArgs', () => {
  const args = buildClaudeArgs(request);

  test('asks for one answer as JSON, with a limit on steps', () => {
    expect(args.slice(0, 2)).toEqual(['-p', request.prompt]);
    expect(valueAfter(args, '--output-format')).toBe('json');
    expect(valueAfter(args, '--max-turns')).toBe('12');
    expect(valueAfter(args, '--system-prompt')).toBe(request.systemPrompt);
  });

  test('gives it only the servers named here and ignores the owner’s other settings', () => {
    expect(args).toContain('--strict-mcp-config');
    expect(JSON.parse(valueAfter(args, '--mcp-config') ?? '')).toEqual({
      mcpServers: request.mcpServers,
    });
    expect(valueAfter(args, '--setting-sources')).toBe('project');
  });

  test('allows the named tools and nothing that reads files, edits or runs commands', () => {
    const allowed = args.slice(
      args.indexOf('--allowedTools') + 1,
      args.indexOf('--disallowedTools'),
    );
    const denied = args.slice(args.indexOf('--disallowedTools') + 1);

    expect(allowed).toEqual(request.allowedTools);
    expect(denied).toEqual(expect.arrayContaining(['Bash', 'Edit', 'Write', 'Read', 'WebFetch']));
    expect(valueAfter(args, '--permission-mode')).toBe('dontAsk');
  });

  test('makes none of Claude Code’s built-in tools available at all', () => {
    expect(valueAfter(args, '--tools')).toBe('');
  });
});

describe('runClaude', () => {
  test('returns the answer text', async () => {
    const { child, started, run } = harness();
    const pending = run();
    child.finish(success('Use fewer words on the thumbnail.'));

    await expect(pending).resolves.toEqual({ text: 'Use fewer words on the thumbnail.', turns: 3 });
    expect(started[0]).toMatchObject({ command: 'claude', cwd: '/tmp/work' });
  });

  test('does not hand Claude Code the owner’s keys', async () => {
    const { child, started, run } = harness({
      PATH: '/bin',
      ANTHROPIC_API_KEY: 'sk-secret',
      YOUTUBE_API_KEY: 'yt-secret',
    });
    const pending = run();
    child.finish(success('ok'));
    await pending;

    expect(started[0]?.env).toEqual({ PATH: '/bin' });
  });

  test('reads an answer that arrives in several pieces', async () => {
    const { child, run } = harness();
    const pending = run();
    const whole = JSON.stringify(success('Long answer'));
    child.stdout.emit('data', whole.slice(0, 10));
    child.stdout.emit('data', whole.slice(10));
    child.emit('close', 0);

    await expect(pending).resolves.toMatchObject({ text: 'Long answer' });
  });

  test('says Claude Code is missing when it cannot be started', async () => {
    const { child, run } = harness();
    const pending = run();
    child.emit('error', Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' }));

    await expect(pending).rejects.toMatchObject({ reason: 'not-installed' });
    await expect(pending).rejects.toBeInstanceOf(EngineRunError);
  });

  test('stops it and says so when it takes too long', async () => {
    const { child, run } = harness();

    await expect(run({ ...request, timeoutMs: 20 })).rejects.toMatchObject({ reason: 'timeout' });
    expect(child.killed).toBe(true);
  });

  test('passes on a usage limit in Claude’s own words', async () => {
    const { child, run } = harness();
    const pending = run();
    child.finish(
      {
        type: 'result',
        subtype: 'success',
        is_error: true,
        result: "You've hit your session limit · resets 4pm",
      },
      1,
    );

    await expect(pending).rejects.toMatchObject({
      reason: 'limit',
      message: expect.stringContaining('session limit'),
    });
  });

  test('explains running out of steps', async () => {
    const { child, run } = harness();
    const pending = run();
    child.finish({ type: 'result', subtype: 'error_max_turns', is_error: true });

    await expect(pending).rejects.toMatchObject({
      reason: 'failed',
      message: expect.stringMatching(/steps/),
    });
  });

  test('reports a reply it cannot read, without file paths from the error text', async () => {
    const { child, run } = harness();
    const pending = run();
    child.finish('not json at all', 2, 'Error at /home/someone/.claude/x.js: bad flag');

    const failure = await pending.catch((error: unknown) => error as EngineRunError);

    expect(failure).toMatchObject({ reason: 'failed' });
    expect((failure as EngineRunError).message).not.toContain('/home/someone');
  });

  test('reads characters that arrive split across two pieces', async () => {
    const { child, run } = harness();
    const pending = run();
    const answer = 'Señor café — 日本語のタイトル 🚀';
    const bytes = Buffer.from(JSON.stringify(success(answer)));
    // Cut inside the four bytes of the rocket, and inside a three-byte character.
    const rocket = bytes.indexOf(Buffer.from('🚀')) + 2;
    const kanji = bytes.indexOf(Buffer.from('日')) + 1;
    child.stdout.emit('data', bytes.subarray(0, kanji));
    child.stdout.emit('data', bytes.subarray(kanji, rocket));
    child.stdout.emit('data', bytes.subarray(rocket));
    child.emit('close', 0);

    await expect(pending).resolves.toMatchObject({ text: answer });
  });

  test('reads split characters in the error text too', async () => {
    const { child, run } = harness();
    const pending = run();
    const bytes = Buffer.from('Erreur: clé refusée');
    const cut = bytes.indexOf(Buffer.from('é')) + 1;
    child.stderr.emit('data', bytes.subarray(0, cut));
    child.stderr.emit('data', bytes.subarray(cut));
    child.emit('close', 1);

    await expect(pending).rejects.toMatchObject({
      message: expect.stringContaining('clé refusée'),
    });
  });

  test('asks it to stop, then forces it when it has not gone after a short while', async () => {
    const { child, run } = harness();
    const pending = run({ ...request, timeoutMs: 10 }, { killGraceMs: 30 });
    pending.catch(() => undefined);

    await wait(25);
    expect(child.signals).toEqual(['SIGTERM']);

    await expect(pending).rejects.toMatchObject({ reason: 'timeout' });
    expect(child.signals).toEqual(['SIGTERM', 'SIGKILL']);
  });

  test('reports a stopped run only once the process has gone, so tidying up does not race it', async () => {
    const { child, run } = harness();
    let reported = false;
    const pending = run({ ...request, timeoutMs: 10 }, { killGraceMs: 5000 }).catch(
      (error: unknown) => {
        reported = true;
        return error;
      },
    );

    await wait(40);
    expect(child.signals).toEqual(['SIGTERM']);
    expect(reported).toBe(false);

    child.emit('close', null);
    expect(await pending).toMatchObject({ reason: 'timeout' });
  });

  test('does not force a process that went when asked', async () => {
    const { child, run } = harness();
    const pending = run({ ...request, timeoutMs: 10 }, { killGraceMs: 30 });
    pending.catch(() => undefined);

    await wait(20);
    child.emit('close', null);
    await expect(pending).rejects.toMatchObject({ reason: 'timeout' });
    await wait(50);

    expect(child.signals).toEqual(['SIGTERM']);
  });

  test('reads nothing more once it has given its verdict', async () => {
    const { child, run } = harness();
    let read = false;
    const late = {
      toString: () => {
        read = true;
        return 'more';
      },
    };

    await expect(run({ ...request, timeoutMs: 10 }, { killGraceMs: 5 })).rejects.toMatchObject({
      reason: 'timeout',
    });
    child.stdout.emit('data', late);
    child.stderr.emit('data', late);

    expect(read).toBe(false);
  });

  test('says someone has to sign in when Claude Code says so', async () => {
    const { child, run } = harness();
    const pending = run();
    child.finish(
      {
        type: 'result',
        subtype: 'success',
        is_error: true,
        result: 'Not logged in · Please run /login',
      },
      1,
    );

    await expect(pending).rejects.toMatchObject({
      reason: 'not-signed-in',
      message: expect.stringContaining('Please run /login'),
    });
  });

  test('on Windows, starts a Claude Code installed as claude.cmd through Node, with no shell', async () => {
    const npm = 'C:\\Users\\Jo\\AppData\\Roaming\\npm';
    const entry = `${npm}\\node_modules\\@anthropic-ai\\claude-code\\cli.js`;
    const shim = `"%_prog%"  "%dp0%\\node_modules\\@anthropic-ai\\claude-code\\cli.js" %*`;
    const files: Readonly<Record<string, string>> = { [`${npm}\\claude.cmd`]: shim, [entry]: '' };
    const { child, started, run } = harness({ Path: npm });
    const pending = run(request, {
      platform: 'win32',
      files: { exists: (path) => path in files, read: (path) => files[path] ?? '' },
    });
    child.finish(success('ok'));

    await expect(pending).resolves.toMatchObject({ text: 'ok' });
    expect(started[0]?.command).toBe(process.execPath);
    expect(started[0]?.args.slice(0, 3)).toEqual([entry, '-p', request.prompt]);
    expect(started[0]?.verbatim).toBeUndefined();
  });

  test('on Windows, says Claude Code is not installed when it is nowhere on the path', async () => {
    const { started, run } = harness({ Path: 'C:\\Windows' });

    await expect(
      run(request, { platform: 'win32', files: { exists: () => false, read: () => '' } }),
    ).rejects.toMatchObject({ reason: 'not-installed' });
    expect(started).toEqual([]);
  });

  test('stops the process when Jgtube is closing', async () => {
    const { child, run } = harness();
    const closing = new AbortController();
    const pending = run(request, { signal: closing.signal });
    pending.catch(() => undefined);

    closing.abort();
    expect(child.signals).toEqual(['SIGTERM']);
    child.emit('close', null);

    await expect(pending).rejects.toMatchObject({
      reason: 'failed',
      message: expect.stringMatching(/Jgtube is closing/),
    });
    expect(child.signals).toEqual(['SIGTERM']);
  });

  test('does not start at all once Jgtube is closing', async () => {
    const { started, run } = harness();
    const closing = new AbortController();
    closing.abort();

    await expect(run(request, { signal: closing.signal })).rejects.toMatchObject({
      message: expect.stringMatching(/Jgtube is closing/),
    });
    expect(started).toEqual([]);
  });

  test('gives up on a reply that grows without end', async () => {
    const { child, run } = harness();
    const pending = run();
    child.stdout.emit('data', 'x'.repeat(3_000_000));

    await expect(pending).rejects.toMatchObject({ reason: 'failed' });
    expect(child.killed).toBe(true);
  });
});

describe('runClaude, against what Claude Code really prints', () => {
  test('reads a real successful result', async () => {
    const { child, run } = harness();
    const pending = run();
    child.stdout.emit('data', fixture('claude-result-success'));
    child.emit('close', 0);

    await expect(pending).resolves.toEqual({ text: 'ok', turns: 1 });
  });

  test('reads a result that ran out of steps', async () => {
    const { child, run } = harness();
    const pending = run();
    child.stdout.emit('data', fixture('claude-result-max-turns'));
    child.emit('close', 1);

    await expect(pending).rejects.toMatchObject({
      reason: 'failed',
      message: expect.stringMatching(/ran out of steps/),
    });
  });

  test('reads a result that hit the plan’s usage limit', async () => {
    const { child, run } = harness();
    const pending = run();
    child.stdout.emit('data', fixture('claude-result-usage-limit'));
    child.emit('close', 1);

    await expect(pending).rejects.toMatchObject({
      reason: 'limit',
      message: 'You’ve hit your session limit · resets 4pm',
    });
  });

  test.each(['claude-result-success', 'claude-result-max-turns', 'claude-result-usage-limit'])(
    '%s keeps the fields the saved result had, less its timings',
    (name) => {
      const saved = JSON.parse(fixture(name).toString('utf8')) as Record<string, unknown>;

      expect(saved).toMatchObject({
        type: 'result',
        subtype: expect.any(String),
        is_error: expect.any(Boolean),
        num_turns: expect.any(Number),
        session_id: expect.any(String),
        total_cost_usd: expect.any(Number),
        usage: expect.any(Object),
      });
    },
  );
});

describe('checking Claude Code', () => {
  const answers = (auth: { stdout?: string; code?: number }, version = '2.1.330 (Claude Code)') =>
    scripted((start) => (start.args[0] === '--version' ? { stdout: version } : auth));

  test('reports the version and that someone is signed in, without keeping who', async () => {
    const { started, deps } = answers({
      stdout: JSON.stringify({ loggedIn: true, email: 'owner@example.com' }),
    });

    const status = await claudeEngine.check(deps);

    expect(status).toEqual({
      id: 'claude',
      label: 'Claude Code',
      installed: true,
      signedIn: true,
      version: '2.1.330',
      ready: true,
      note: null,
    });
    expect(JSON.stringify(status)).not.toContain('owner@example.com');
    expect(started.map((start) => start.args)).toEqual([['--version'], ['auth', 'status']]);
  });

  test('reports that nobody is signed in, from the reply or from the exit code', async () => {
    const told = await claudeEngine.check(answers({ stdout: '{"loggedIn":false}', code: 1 }).deps);
    const exited = await claudeEngine.check(answers({ stdout: 'Not logged in', code: 1 }).deps);

    expect(told).toMatchObject({ installed: true, signedIn: false, ready: false });
    expect(exited).toMatchObject({ signedIn: false, ready: false });
  });

  test('does not ask an old Claude Code, which would take the words as a question', async () => {
    const { started, deps } = answers({ stdout: '{"loggedIn":true}' }, '1.0.44 (Claude Code)');

    expect(await claudeEngine.check(deps)).toMatchObject({ signedIn: null, ready: true });
    expect(started).toHaveLength(1);
  });

  test('reports that it is not installed', async () => {
    const { deps } = scripted(() => ({ startError: 'ENOENT' }));

    expect(await claudeEngine.check(deps)).toEqual({
      id: 'claude',
      label: 'Claude Code',
      installed: false,
      signedIn: null,
      version: null,
      ready: false,
      note: null,
    });
  });

  test('leaves sign-in unknown when the question cannot be put', async () => {
    const { deps } = scripted((start) =>
      start.args[0] === '--version' ? { stdout: '2.1.330' } : { startError: 'EACCES' },
    );

    expect(await claudeEngine.check(deps)).toMatchObject({ installed: true, signedIn: null });
  });
});

describe('reading what Claude Code printed', () => {
  test('a finished run with nothing written is a failure, not a blank answer', async () => {
    const { child, run } = harness();
    const pending = run();
    child.finish(success('   '));

    await expect(pending).rejects.toMatchObject({
      reason: 'failed',
      message: expect.stringMatching(/without writing an answer/),
    });
  });

  test('finds the reply when a notice was printed ahead of it', async () => {
    const { child, run } = harness();
    const pending = run();
    child.finish(`A new version is available.\n${JSON.stringify(success('Still read.'))}\n`);

    await expect(pending).resolves.toMatchObject({ text: 'Still read.' });
  });

  test.each([
    '5-hour limit reached - resets 3pm',
    'The weekly limit has been reached',
    'Credit balance is too low',
    "You've hit your session limit",
  ])('reads %j as the plan being out of allowance', async (result) => {
    const { child, run } = harness();
    const pending = run();
    child.finish({ ...success(result), is_error: true }, 1);

    await expect(pending).rejects.toMatchObject({ reason: 'limit' });
  });

  test('does not take a website turning a tool away for a missing sign-in', async () => {
    const { child, run } = harness();
    const pending = run();
    child.finish(
      { ...success('tool call failed: 401 Unauthorized from YouTube'), is_error: true },
      1,
    );

    await expect(pending).rejects.toMatchObject({ reason: 'failed' });
  });

  test('takes the answer of a program that has exited while something still holds its output open', async () => {
    const { child, run } = harness();
    const pending = run(request, { closeAfterExitMs: 10 });
    child.stdout.emit('data', JSON.stringify(success('Printed before exit.')));
    child.emit('exit', 0);

    await expect(pending).resolves.toMatchObject({ text: 'Printed before exit.' });
  });

  test('withholds a key however its name is capitalised, as Windows allows', async () => {
    const { child, started, run } = harness({
      Path: 'C:\\bin',
      Gemini_Api_Key: 'g',
      gh_token: 't',
    });
    const pending = run();
    child.finish(success('ok'));
    await pending;

    expect(started[0]?.env).toEqual({ Path: 'C:\\bin' });
  });
});
