import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { runCodex } from '../../src/engines/codex';
import { runProcess, spawnProcess } from '../../src/engines/process';
import type { EngineDeps, EngineRunRequest, Program, SpawnProcess } from '../../src/engines/types';

/**
 * These start a real process: Node itself, running a small script, stands in
 * for the program. Nothing here reaches the network.
 */
const NODE: Program = { command: process.execPath, label: 'The stand-in', name: 'Stand-in' };
const STAND_IN = fileURLToPath(new URL('../fixtures/stand-in-codex.mjs', import.meta.url));
const deps: EngineDeps = { spawn: spawnProcess, env: { PATH: process.env['PATH'] } };
const run = (script: string, more: { input?: string; timeoutMs?: number } = {}) =>
  runProcess(
    { program: NODE, args: ['-e', script], cwd: tmpdir(), timeoutMs: 10_000, ...more },
    deps,
  );

describe('runProcess with a real process', () => {
  test('hands back what the process printed and how it ended', async () => {
    const output = await run('console.log("out"); console.error("err"); process.exit(3)');

    expect(output).toEqual({ stdout: 'out\n', stderr: 'err\n', code: 3 });
  });

  test('sends text to the process on its input, however odd the text', async () => {
    const text = 'He said "hi" & left %PATH% $(whoami) `id`\nsecond line 🚀';
    const output = await run(
      'let all = ""; process.stdin.on("data", (d) => (all += d)).on("end", () => process.stdout.write(all))',
      { input: text },
    );

    expect(output.stdout).toBe(text);
  });

  test('gives a process with no input an input that has already ended', async () => {
    const output = await run(
      'process.stdin.on("data", () => {}).on("end", () => console.log("ended"))',
    );

    expect(output.stdout).toBe('ended\n');
  });

  test('passes arguments on exactly, with no shell to read them', async () => {
    const odd = ['a b', '"quoted"', '$HOME', '; echo no', '&& exit', '%PATH%', 'new\nline'];
    const output = await runProcess(
      {
        program: NODE,
        args: ['-e', 'console.log(JSON.stringify(process.argv.slice(1)))', ...odd],
        cwd: tmpdir(),
        timeoutMs: 10_000,
      },
      deps,
    );

    expect(JSON.parse(output.stdout)).toEqual(odd);
  });

  test('does not hand the process the owner’s keys', async () => {
    const output = await runProcess(
      {
        program: NODE,
        args: [
          '-e',
          'console.log(Object.keys(process.env).filter((k) => k.endsWith("_KEY")).join())',
        ],
        cwd: tmpdir(),
        timeoutMs: 10_000,
      },
      { ...deps, env: { ...deps.env, GEMINI_API_KEY: 'g', CODEX_API_KEY: 'c', OTHER: 'kept' } },
    );

    expect(output.stdout).toBe('\n');
  });

  test('stops a process that runs past its time', async () => {
    await expect(run('setInterval(() => {}, 1000)', { timeoutMs: 150 })).rejects.toMatchObject({
      reason: 'timeout',
      message: 'Stand-in took too long and was stopped. Try again.',
    });
  });

  test('does not fall over when the process ends without reading its input', async () => {
    const output = await run('process.exit(0)', { input: 'x'.repeat(200_000) });

    expect(output.code).toBe(0);
  });

  test('says a program is not installed when there is no such command', async () => {
    const missing: Program = {
      command: 'jgtube-no-such-program',
      label: 'Nothing',
      name: 'Nothing',
    };

    await expect(
      runProcess({ program: missing, args: [], cwd: tmpdir(), timeoutMs: 1000 }, deps),
    ).rejects.toMatchObject({ reason: 'not-installed' });
  });

  test('reports a program that cannot be started for another reason', async () => {
    const broken: SpawnProcess = () => {
      throw Object.assign(new Error('spawn EACCES /home/someone/bin/x'), { code: 'EACCES' });
    };
    const failure = runProcess(
      { program: NODE, args: [], cwd: tmpdir(), timeoutMs: 1000 },
      { ...deps, spawn: broken },
    );

    await expect(failure).rejects.toMatchObject({
      reason: 'failed',
      message: expect.stringMatching(/^The stand-in could not be started/),
    });
    await expect(failure).rejects.not.toMatchObject({
      message: expect.stringContaining('/home/someone'),
    });
  });
});

describe('the Codex engine against a stand-in process', () => {
  const request: EngineRunRequest = {
    prompt: 'Which videos should I make next?',
    systemPrompt: 'You are a YouTube analyst.',
    mcpServers: { jgtube: { command: 'node', args: ['C:\\app\\mcp.js'] } },
    allowedTools: ['mcp__jgtube__get_map'],
    maxTurns: 4,
    timeoutMs: 10_000,
    cwd: tmpdir(),
  };
  /** Starts the stand-in script with Node wherever the engine asks for `codex`. */
  const standIn: SpawnProcess = (_command, args, options) =>
    spawnProcess(process.execPath, [STAND_IN, ...args], options);

  test('gets the sign-in, the settings and the prompt across a real process boundary', async () => {
    const answer = await runCodex(request, { ...deps, spawn: standIn });
    const seen = JSON.parse(answer.text) as { prompt: string; settings: Record<string, string> };

    expect(seen.prompt).toBe('You are a YouTube analyst.\n\nWhich videos should I make next?');
    expect(seen.settings['mcp_servers.jgtube.args']).toBe('["C:\\\\app\\\\mcp.js"]');
    expect(seen.settings['mcp_servers.jgtube.enabled_tools']).toBe('["get_map"]');
    expect(seen.settings['web_search']).toBe('"disabled"');
  });
});
