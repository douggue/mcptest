import { describe, expect, test } from 'vitest';
import { buildCodexArgs, codexEngine, runCodex } from '../../src/engines/codex';
import type { EngineRunRequest } from '../../src/engines/types';
import { scripted, type Scripted, type Started } from './standIn';

const request: EngineRunRequest = {
  prompt: 'Which videos should I make next?',
  systemPrompt: 'You are a YouTube analyst.',
  mcpServers: {
    jgtube: {
      command: 'node',
      args: ['C:\\app\\node_modules\\tsx\\dist\\cli.mjs', 'C:\\app\\packages\\mcp\\src\\main.ts'],
      env: { JGTUBE_DB_PATH: 'C:\\data\\jgtube.db' },
    },
  },
  allowedTools: ['mcp__jgtube__get_map', 'mcp__jgtube__get_breakouts'],
  maxTurns: 12,
  timeoutMs: 1000,
  cwd: '/tmp/work',
};

const line = (event: unknown): string => `${JSON.stringify(event)}\n`;
const message = (text: string) =>
  line({ type: 'item.completed', item: { id: 'item_1', type: 'agent_message', text } });
const answered = (text: string): string =>
  [
    line({ type: 'thread.started', thread_id: 't1' }),
    line({ type: 'turn.started' }),
    message(text),
    line({ type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 5 } }),
  ].join('');

const isLogin = (start: Started): boolean => start.args[0] === 'login';
/** A signed-in Codex whose one run prints `exec`. */
const codex = (exec: Scripted, env?: Record<string, string | undefined>) =>
  scripted((start) => (isLogin(start) ? { stdout: 'Logged in using ChatGPT' } : exec), env);

/** The value of each `-c key=value` setting, by key. */
function settings(args: readonly string[]): Readonly<Record<string, string>> {
  const pairs = args.flatMap((arg, index) => (arg === '-c' ? [args[index + 1] ?? ''] : []));
  return Object.fromEntries(
    pairs.map((pair) => [pair.slice(0, pair.indexOf('=')), pair.slice(pair.indexOf('=') + 1)]),
  );
}

describe('buildCodexArgs', () => {
  const args = buildCodexArgs(request);

  test('asks for one run that prints events, keeps nothing and reads the prompt from its input', () => {
    expect(args.slice(0, 5)).toEqual([
      'exec',
      '--json',
      '--ephemeral',
      '--skip-git-repo-check',
      '--ignore-user-config',
    ]);
    expect(args.at(-1)).toBe('-');
    expect(args).not.toContain(request.prompt);
  });

  test('may only read, starts in the private folder, and has no web search, shell or image opener', () => {
    expect(args[args.indexOf('--sandbox') + 1]).toBe('read-only');
    expect(args[args.indexOf('-C') + 1]).toBe('/tmp/work');
    expect(settings(args)).toMatchObject({
      web_search: '"disabled"',
      'features.shell_tool': 'false',
      'features.view_image': 'false',
    });
  });

  test('offers the tool server as TOML, with Windows paths escaped', () => {
    expect(settings(args)).toMatchObject({
      'mcp_servers.jgtube.command': '"node"',
      'mcp_servers.jgtube.args':
        '["C:\\\\app\\\\node_modules\\\\tsx\\\\dist\\\\cli.mjs", "C:\\\\app\\\\packages\\\\mcp\\\\src\\\\main.ts"]',
      'mcp_servers.jgtube.env': '{ JGTUBE_DB_PATH = "C:\\\\data\\\\jgtube.db" }',
    });
  });

  test('requires the server, approves its tools ahead of time and offers only the allowed ones', () => {
    expect(settings(args)).toMatchObject({
      'mcp_servers.jgtube.required': 'true',
      'mcp_servers.jgtube.default_tools_approval_mode': '"approve"',
      'mcp_servers.jgtube.enabled_tools': '["get_map", "get_breakouts"]',
    });
  });

  test('leaves out the environment of a server that has none', () => {
    const bare = buildCodexArgs({
      ...request,
      mcpServers: { jgtube: { command: 'node', args: [] } },
    });

    expect(settings(bare)).not.toHaveProperty('mcp_servers.jgtube.env');
  });

  test('refuses a server name that could not be a plain TOML key', () => {
    const odd = { ...request, mcpServers: { 'a.b': { command: 'node', args: [] } } };

    expect(() => buildCodexArgs(odd)).toThrow(/server name/);
  });
});

describe('runCodex', () => {
  test('checks the sign-in, then sends the instructions and the question on the input', async () => {
    const { started, deps } = codex({ stdout: answered('Make the bridge video.') });

    await expect(runCodex(request, deps)).resolves.toEqual({
      text: 'Make the bridge video.',
      turns: null,
    });
    expect(started.map((start) => [start.command, start.args[0]])).toEqual([
      ['codex', 'login'],
      ['codex', 'exec'],
    ]);
    expect(started[0]?.args).toEqual(['login', 'status']);
    expect(started[1]?.input).toBe(
      'You are a YouTube analyst.\n\nWhich videos should I make next?',
    );
    expect(started[1]?.cwd).toBe('/tmp/work');
  });

  test('takes the last message as the answer', async () => {
    const stdout = [message('Looking at the map first.'), message('Final answer.')].join('');
    const { deps } = codex({ stdout });

    await expect(runCodex(request, deps)).resolves.toMatchObject({ text: 'Final answer.' });
  });

  test('skips lines that are not events, and items that are not messages', async () => {
    const stdout = [
      'warming up\n',
      line({ type: 'item.completed', item: { type: 'mcp_tool_call', text: 'not the answer' } }),
      line({ type: 'item.started', item: { type: 'agent_message', text: 'not finished' } }),
      message('The answer.'),
      '\n',
    ].join('');

    await expect(runCodex(request, codex({ stdout }).deps)).resolves.toMatchObject({
      text: 'The answer.',
    });
  });

  test('does not hand Codex the owner’s keys', async () => {
    const { started, deps } = codex(
      { stdout: answered('ok') },
      { PATH: '/bin', CODEX_API_KEY: 'sk-codex', OPENAI_API_KEY: 'sk-openai', GEMINI_API_KEY: 'g' },
    );
    await runCodex(request, deps);

    expect(started.map((start) => start.env)).toEqual([{ PATH: '/bin' }, { PATH: '/bin' }]);
  });

  test('says nobody is signed in, without starting a run', async () => {
    const { started, deps } = scripted(() => ({ stdout: 'Not logged in', code: 1 }));

    await expect(runCodex(request, deps)).rejects.toMatchObject({
      reason: 'not-signed-in',
      message: expect.stringMatching(/codex login/),
    });
    expect(started).toHaveLength(1);
  });

  test('says Codex is not installed', async () => {
    const { deps } = scripted(() => ({ startError: 'ENOENT' }));

    await expect(runCodex(request, deps)).rejects.toMatchObject({
      reason: 'not-installed',
      message: expect.stringMatching(/Codex CLI is not installed/),
    });
  });

  test.each([
    [
      {
        type: 'turn.failed',
        error: { message: 'You have hit your usage limit. Try again at 4pm.' },
      },
    ],
    [{ type: 'error', message: 'Rate limit reached for requests' }],
  ])('passes on a plan limit in Codex’s own words: %j', async (event) => {
    const { deps } = codex({ stdout: line(event), code: 1 });

    await expect(runCodex(request, deps)).rejects.toMatchObject({
      reason: 'limit',
      message: expect.stringMatching(/limit/i),
    });
  });

  test('reports a failed turn, without file paths', async () => {
    const stdout = line({
      type: 'turn.failed',
      error: { message: 'MCP server jgtube failed to start at /home/someone/app/x.ts' },
    });
    const failure = runCodex(request, codex({ stdout, code: 1 }).deps);

    await expect(failure).rejects.toMatchObject({ reason: 'failed' });
    await expect(failure).rejects.not.toMatchObject({
      message: expect.stringContaining('/home/someone'),
    });
  });

  test('keeps the answer when an earlier error was got over', async () => {
    const stdout = [
      line({ type: 'error', message: 'Reconnecting... 1/5' }),
      answered('Got there in the end.'),
    ].join('');

    await expect(runCodex(request, codex({ stdout }).deps)).resolves.toMatchObject({
      text: 'Got there in the end.',
    });
  });

  test('reports a run that ends with no answer and no reason, from its error text', async () => {
    const { deps } = codex({ stdout: '', stderr: 'error: unexpected argument', code: 2 });

    await expect(runCodex(request, deps)).rejects.toMatchObject({
      reason: 'failed',
      message: expect.stringMatching(/exit code 2.*unexpected argument/),
    });
  });

  test('reports a clean exit with no answer', async () => {
    const { deps } = codex({ stdout: line({ type: 'turn.completed' }) });

    await expect(runCodex(request, deps)).rejects.toMatchObject({
      reason: 'failed',
      message: expect.stringMatching(/without an answer/),
    });
  });

  test('says nobody is signed in when the run itself says so', async () => {
    const stdout = line({ type: 'error', message: '401 Unauthorized: please log in again' });

    await expect(runCodex(request, codex({ stdout, code: 1 }).deps)).rejects.toMatchObject({
      reason: 'not-signed-in',
    });
  });
});

describe('checking Codex', () => {
  test('reports the version and the sign-in', async () => {
    const { deps } = scripted((start) =>
      isLogin(start) ? { stdout: 'Logged in using ChatGPT' } : { stdout: 'codex-cli 0.171.0' },
    );

    expect(await codexEngine.check(deps)).toEqual({
      id: 'codex',
      label: 'Codex CLI',
      installed: true,
      signedIn: true,
      version: '0.171.0',
      ready: true,
      note: null,
    });
  });

  test('reports that nobody is signed in', async () => {
    const { deps } = scripted((start) =>
      isLogin(start) ? { code: 1 } : { stdout: 'codex-cli 0.171.0' },
    );

    expect(await codexEngine.check(deps)).toMatchObject({ signedIn: false, ready: false });
  });

  test('reports that it is not installed, and leaves sign-in unknown when it cannot ask', async () => {
    const missing = scripted(() => ({ startError: 'ENOENT' }));
    const stuck = scripted((start) =>
      isLogin(start) ? { startError: 'EACCES' } : { stdout: 'codex-cli 0.171.0' },
    );

    expect(await codexEngine.check(missing.deps)).toMatchObject({ installed: false, ready: false });
    expect(await codexEngine.check(stuck.deps)).toMatchObject({ installed: true, signedIn: null });
  });
});
