import { describe, expect, test } from 'vitest';
import { buildClaudeArgs } from '../../src/engines/claude';
import {
  WEB_ENGINES,
  WEB_TOOLS,
  buildClaudeWebArgs,
  buildCodexWebArgs,
  runClaudeWeb,
  type WebRunRequest,
} from '../../src/engines/webRun';
import { harness } from './standIn';

const request: WebRunRequest = {
  prompt: 'Research the subject.',
  systemPrompt: 'You are a researcher.',
  maxTurns: 20,
  timeoutMs: 1000,
  cwd: '/tmp/private',
};

const after = (args: readonly string[], flag: string) => args[args.indexOf(flag) + 1];

describe('a web-only research run of Claude Code', () => {
  const args = buildClaudeWebArgs(request);

  test('has only the built-in web search and fetch tools', () => {
    expect(after(args, '--tools')).toBe('WebSearch,WebFetch');
    expect(WEB_TOOLS).toEqual(['WebSearch', 'WebFetch']);
    const allowed = args.slice(
      args.indexOf('--allowedTools') + 1,
      args.indexOf('--disallowedTools'),
    );
    expect(allowed).toEqual(['WebSearch', 'WebFetch']);
  });

  test('never has the Jgtube connector or any other tool server, file, shell or edit tool', () => {
    expect(args).toContain('--strict-mcp-config');
    expect(after(args, '--mcp-config')).toBe('{"mcpServers":{}}');
    expect(args.join(' ')).not.toContain('jgtube');
    const denied = args.slice(args.indexOf('--disallowedTools') + 1);
    for (const tool of ['Bash', 'Edit', 'Write', 'Read', 'Glob', 'Grep', 'Agent', 'Task']) {
      expect(denied).toContain(tool);
    }
    expect(denied).not.toContain('WebSearch');
  });

  test('ignores the owner’s settings and asks nothing', () => {
    expect(after(args, '--setting-sources')).toBe('project');
    expect(after(args, '--permission-mode')).toBe('dontAsk');
    expect(after(args, '-p')).toBe('Research the subject.');
  });

  test('is the only web engine Jgtube runs; the others are written down unproven', () => {
    expect(WEB_ENGINES).toEqual(['claude']);
    expect(buildCodexWebArgs(request)).toContain('web_search="live"');
  });

  test('runs in the private folder with keys withheld, and reads the answer', async () => {
    const { child, started, deps } = harness({ PATH: '/bin', ANTHROPIC_API_KEY: 'sk-fake' });
    const running = runClaudeWeb(request, deps);
    child.finish({
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: 'FACT 1: x',
      num_turns: 3,
    });

    await expect(running).resolves.toEqual({ text: 'FACT 1: x', turns: 3 });
    expect(started[0]?.cwd).toBe('/tmp/private');
    expect(started[0]?.env['ANTHROPIC_API_KEY']).toBeUndefined();
  });
});

describe('a YouTube-reading run', () => {
  test('never gets a web tool', () => {
    const args = buildClaudeArgs({
      ...request,
      mcpServers: { jgtube: { command: 'node', args: ['x'] } },
      allowedTools: ['mcp__jgtube__get_map'],
    });

    expect(after(args, '--tools')).toBe('');
    expect(args.slice(args.indexOf('--disallowedTools') + 1)).toEqual(
      expect.arrayContaining(['WebSearch', 'WebFetch']),
    );
  });
});
