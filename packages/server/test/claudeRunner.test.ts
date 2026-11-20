import { EventEmitter } from 'node:events';
import { describe, expect, test } from 'vitest';
import {
  ClaudeRunError,
  buildClaudeArgs,
  runClaude,
  type ClaudeChild,
  type ClaudeRunRequest,
  type SpawnClaude,
} from '../src/claudeRunner';

const request: ClaudeRunRequest = {
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

/** A stand-in for the Claude Code process that the test drives by hand. */
class FakeChild extends EventEmitter implements ClaudeChild {
  readonly stdout = new EventEmitter();
  readonly stderr = new EventEmitter();
  killed = false;

  kill(): void {
    this.killed = true;
  }

  finish(output: unknown, code = 0, errorText = ''): void {
    if (output !== undefined) {
      this.stdout.emit('data', typeof output === 'string' ? output : JSON.stringify(output));
    }
    if (errorText) this.stderr.emit('data', errorText);
    this.emit('close', code);
  }
}

interface Started {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
}

function harness(env: Record<string, string | undefined> = { PATH: '/bin' }) {
  const child = new FakeChild();
  const started: Started[] = [];
  const spawn: SpawnClaude = (command, args, options) => {
    started.push({ command, args, cwd: options.cwd, env: options.env });
    return child;
  };
  return { child, started, run: (r = request) => runClaude(r, { spawn, env }) };
}

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
    await expect(pending).rejects.toBeInstanceOf(ClaudeRunError);
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

    const failure = await pending.catch((error: unknown) => error as ClaudeRunError);

    expect(failure).toMatchObject({ reason: 'failed' });
    expect((failure as ClaudeRunError).message).not.toContain('/home/someone');
  });

  test('gives up on a reply that grows without end', async () => {
    const { child, run } = harness();
    const pending = run();
    child.stdout.emit('data', 'x'.repeat(3_000_000));

    await expect(pending).rejects.toMatchObject({ reason: 'failed' });
    expect(child.killed).toBe(true);
  });
});
