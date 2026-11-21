import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { agyMcpConfig, allowsServer, buildAgyArgs, createAgyEngine } from '../../src/engines/agy';
import type { EngineDeps, EngineRunRequest, FileLookup } from '../../src/engines/types';
import { scripted, type Scripted, type Started } from './standIn';

const HOME = '/home/owner';
const SETTINGS = join(HOME, '.gemini', 'antigravity-cli', 'settings.json');
const ALLOWED = JSON.stringify({ permissions: { allow: ['mcp(jgtube/*)'] } });

let work: string;
beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), 'jgtube-agy-test-'));
});
afterEach(() => rmSync(work, { recursive: true, force: true }));

const request = (): EngineRunRequest => ({
  prompt: 'Which videos should I make next?',
  systemPrompt: 'You are a YouTube analyst.',
  mcpServers: {
    jgtube: { command: 'node', args: ['/app/mcp.js'], env: { JGTUBE_DB_PATH: '/data/x.db' } },
  },
  allowedTools: ['mcp__jgtube__get_map', 'mcp__jgtube__get_breakouts'],
  maxTurns: 12,
  timeoutMs: 5 * 60 * 1000,
  cwd: work,
});

const settingsFile = (text: string | null): FileLookup => ({
  exists: (path) => path === SETTINGS && text !== null,
  read: (path) => {
    if (path !== SETTINGS || text === null) throw new Error('no such file');
    return text;
  },
});

const success = (response: string, more: Record<string, unknown> = {}): string =>
  JSON.stringify({ status: 'SUCCESS', response, num_turns: 4, ...more });

/** A stand-in `agy` and the owner's settings file. */
function agy(
  reply: Scripted | ((start: Started) => Scripted),
  settings: string | null = ALLOWED,
  env?: Record<string, string | undefined>,
) {
  const { started, deps } = scripted(typeof reply === 'function' ? reply : () => reply, env);
  const full: EngineDeps = { ...deps, homeDir: HOME, files: settingsFile(settings) };
  return { started, deps: full };
}

const engine = createAgyEngine({ toolServer: 'jgtube' });

describe('buildAgyArgs', () => {
  test('asks for one answer as JSON, in the sandbox, with its own time limit', () => {
    expect(buildAgyArgs('Say hello.', 5 * 60 * 1000)).toEqual([
      '-p',
      'Say hello.',
      '--output-format',
      'json',
      '--sandbox',
      '--print-timeout',
      '5m',
    ]);
  });

  test('rounds the time limit up to whole minutes, and names a model only when one is set', () => {
    expect(buildAgyArgs('x', 61_000).at(-1)).toBe('2m');
    expect(buildAgyArgs('x', 500).at(-1)).toBe('1m');
    expect(buildAgyArgs('x', 60_000, 'Gemini 3.8 Flash').slice(-2)).toEqual([
      '--model',
      'Gemini 3.8 Flash',
    ]);
  });
});

describe('agyMcpConfig', () => {
  test('offers each server with only its allowed tools', () => {
    expect(agyMcpConfig(request())).toEqual({
      mcpServers: {
        jgtube: {
          command: 'node',
          args: ['/app/mcp.js'],
          env: { JGTUBE_DB_PATH: '/data/x.db' },
          enabledTools: ['get_map', 'get_breakouts'],
        },
      },
    });
  });
});

describe('allowsServer', () => {
  const tools = ['get_map', 'get_breakouts'];
  const allow = (...rules: string[]) => JSON.stringify({ permissions: { allow: rules } });

  test.each([
    [allow('mcp(jgtube/*)')],
    [allow('command(git status)', 'mcp(*)')],
    [allow('mcp(jgtube/get_map)', 'mcp(jgtube/get_breakouts)')],
    [JSON.stringify({ toolPermission: 'always-proceed' })],
  ])('is true for %s', (settings) => {
    expect(allowsServer(settings, 'jgtube', tools)).toBe(true);
  });

  test.each([
    [null],
    ['not json'],
    ['{}'],
    [allow('mcp(other/*)')],
    [allow('mcp(jgtube/get_map)')],
    [JSON.stringify({ permissions: { allow: ['mcp(jgtube/*)'], deny: ['mcp(jgtube/*)'] } })],
    [JSON.stringify({ permissions: { allow: ['mcp(*)'], deny: ['mcp(*)'] } })],
    [JSON.stringify({ permissions: { allow: 'mcp(jgtube/*)' } })],
  ])('is false for %s', (settings) => {
    expect(allowsServer(settings, 'jgtube', tools)).toBe(false);
  });
});

describe('running Antigravity with tools', () => {
  test('writes the tool server into a fresh folder of its own, runs there and returns the answer', async () => {
    let seen: { cwd: string; config: unknown; mode: number } | null = null;
    const { started, deps } = agy((start) => {
      const file = join(start.cwd, '.agents', 'mcp_config.json');
      seen = {
        cwd: start.cwd,
        config: JSON.parse(readFileSync(file, 'utf8')),
        mode: statSync(file).mode & 0o077,
      };
      return { stdout: success('Make the bridge video.') };
    });

    await expect(engine.run(request(), deps)).resolves.toEqual({
      text: 'Make the bridge video.',
      turns: 4,
    });
    expect(started[0]?.command).toBe('agy');
    expect(started[0]?.args.slice(0, 2)).toEqual([
      '-p',
      'You are a YouTube analyst. Which videos should I make next?',
    ]);
    // One line: a line break is the one thing a Windows `.cmd` program cannot be passed.
    expect(started[0]?.args[1]).not.toMatch(/[\r\n]/);
    expect(seen).toMatchObject({ config: agyMcpConfig(request()), mode: 0 });
    expect(seen!.cwd.startsWith(join(work, 'run-'))).toBe(true);
  });

  test('removes that folder afterwards, whether the run worked or not', async () => {
    await engine.run(request(), agy({ stdout: success('ok') }).deps);
    await engine.run(request(), agy({ stdout: 'broken', code: 1 }).deps).catch(() => undefined);

    expect(readdirSync(work)).toEqual([]);
  });

  test('never writes to the owner’s own settings', async () => {
    await engine.run(request(), agy({ stdout: success('ok') }).deps);

    expect(existsSync(SETTINGS)).toBe(false);
  });

  test('is passed over, before any run, while the owner’s settings do not allow the tools', async () => {
    const { started, deps } = agy({ stdout: success('never') }, '{}');

    await expect(engine.run(request(), deps)).rejects.toMatchObject({
      reason: 'not-signed-in',
      message: expect.stringContaining('"mcp(jgtube/*)"'),
    });
    expect(started).toEqual([]);
    expect(readdirSync(work)).toEqual([]);
  });

  test('does not hand Antigravity the owner’s keys', async () => {
    const { started, deps } = agy({ stdout: success('ok') }, ALLOWED, {
      PATH: '/bin',
      GEMINI_API_KEY: 'g-secret',
      GOOGLE_API_KEY: 'g2',
      ANTHROPIC_API_KEY: 'a',
    });
    await engine.run(request(), deps);

    expect(started[0]?.env).toEqual({ PATH: '/bin' });
  });

  test('names the model when a setting does', async () => {
    const withModel = createAgyEngine({ toolServer: 'jgtube', model: 'Gemini 3.8 Flash' });
    const { started, deps } = agy({ stdout: success('ok') });
    await withModel.run(request(), deps);

    expect(started[0]?.args.slice(-2)).toEqual(['--model', 'Gemini 3.8 Flash']);
  });

  test.each([
    ['its list of refused actions', { denied_actions: [{ action: 'mcp(jgtube/get_map)' }] }, ''],
    ['a notice on its error output', {}, 'Permission denied (soft): mcp jgtube/get_map\n'],
    ['a notice naming the tool call', {}, 'notice: call_mcp_tool was denied in headless mode\n'],
  ])(
    'fails, with the line to add, when %s shows the tools were refused',
    async (_, more, stderr) => {
      const { deps } = agy({ stdout: success('I could not reach the tools.', more), stderr });

      await expect(engine.run(request(), deps)).rejects.toMatchObject({
        reason: 'failed',
        message: expect.stringContaining('"mcp(jgtube/*)"'),
      });
    },
  );

  test('keeps the answer when something else was refused: that is the box working', async () => {
    const { deps } = agy({
      stdout: success('Here is the answer.', { denied_actions: [{ action: 'command(ls)' }] }),
      stderr: 'Permission denied (soft): command(ls)\n',
    });

    await expect(engine.run(request(), deps)).resolves.toMatchObject({
      text: 'Here is the answer.',
    });
  });

  test('says nobody is signed in when Antigravity asks for authentication', async () => {
    const { deps } = agy({ stdout: '', stderr: 'Error: authentication required\n', code: 1 });

    await expect(engine.run(request(), deps)).rejects.toMatchObject({
      reason: 'not-signed-in',
      message: expect.stringMatching(/sign in/),
    });
  });

  test('says Antigravity is not installed', async () => {
    const { deps } = agy({ startError: 'ENOENT' });

    await expect(engine.run(request(), deps)).rejects.toMatchObject({ reason: 'not-installed' });
  });

  test('passes on a plan limit, read from its error line', async () => {
    const stderr = 'AGY_ERROR: {"message":"Quota exceeded for this model. Resets at 4pm."}\n';
    const { deps } = agy({ stdout: '', stderr, code: 3 });

    await expect(engine.run(request(), deps)).rejects.toMatchObject({
      reason: 'limit',
      message: 'Quota exceeded for this model. Resets at 4pm.',
    });
  });

  test('says it took too long when Antigravity’s own time limit ends the run', async () => {
    const stdout = JSON.stringify({ status: 'ERROR', error: 'print timeout: timed out after 5m' });

    await expect(engine.run(request(), agy({ stdout, code: 3 }).deps)).rejects.toMatchObject({
      reason: 'timeout',
    });
  });

  test.each([
    [
      JSON.stringify({ status: 'ERROR', error: { message: 'model not found' } }),
      1,
      /model not found/,
    ],
    [JSON.stringify({ status: 'CANCELED' }), 0, /CANCELED/],
    [JSON.stringify({ status: 'SUCCESS', response: '' }), 0, /without an answer/],
    ['not json', 2, /exit code 2/],
  ])('reports a run that gave no answer: %s', async (stdout, code, wording) => {
    await expect(engine.run(request(), agy({ stdout, code }).deps)).rejects.toMatchObject({
      reason: 'failed',
      message: expect.stringMatching(wording),
    });
  });

  test('does not repeat file paths from the error output', async () => {
    const { deps } = agy({ stdout: '', stderr: 'crash at /home/someone/.gemini/x.js', code: 1 });
    const failure = await engine.run(request(), deps).then(
      () => new Error('it did not fail'),
      (error: unknown) => error as Error,
    );

    expect(failure.message).not.toContain('/home/someone');
  });
});

describe('checking Antigravity', () => {
  test('reports the version, and that sign-in cannot be told without asking it a question', async () => {
    const { deps } = agy({ stdout: 'agy 1.5.12' });

    expect(await engine.check(deps)).toEqual({
      id: 'agy',
      label: 'Antigravity CLI',
      installed: true,
      signedIn: null,
      version: '1.5.12',
      ready: true,
      note: null,
    });
  });

  test('says which line is missing when the settings do not allow the tools', async () => {
    const status = await engine.check(agy({ stdout: 'agy 1.5.12' }, null).deps);

    expect(status).toMatchObject({ installed: true, ready: false });
    expect(status.note).toContain('"mcp(jgtube/*)"');
  });

  test('reports that it is not installed, with nothing to add', async () => {
    expect(await engine.check(agy({ startError: 'ENOENT' }, null).deps)).toEqual({
      id: 'agy',
      label: 'Antigravity CLI',
      installed: false,
      signedIn: null,
      version: null,
      ready: false,
      note: null,
    });
  });

  test('counts it as installed when it starts but does not know the version question', async () => {
    const { deps } = agy({ stderr: 'unknown flag: --version', code: 2 });

    expect(await engine.check(deps)).toMatchObject({ installed: true, version: null });
  });
});

describe('checking Antigravity when the owner listed each tool', () => {
  test('counts rules that name the server’s tools one by one, as the run does', async () => {
    const each = JSON.stringify({
      permissions: { allow: ['mcp(jgtube/get_map)', 'mcp(jgtube/get_breakouts)'] },
    });

    expect(await engine.check(agy({ stdout: 'agy 1.5.12' }, each).deps)).toMatchObject({
      ready: true,
      note: null,
    });
    expect(allowsServer(each, 'jgtube', ['get_map', 'get_breakouts'])).toBe(true);
    expect(allowsServer(each, 'jgtube', ['get_map', 'make_map'])).toBe(false);
    expect(allowsServer(each, 'other', [])).toBe(false);
  });
});
