import { describe, expect, test } from 'vitest';
import { aiBadge } from '../src/lib/aiBadge';
import type { EngineReport, EngineStatus } from '../src/lib/analyses';

const status = (
  id: EngineStatus['id'],
  ready: boolean,
  label = id,
  installed = true,
): EngineStatus => ({
  id,
  label,
  installed,
  signedIn: null,
  version: null,
  ready,
  note: null,
});

const report = (overrides: Partial<EngineReport> = {}): EngineReport => ({
  engines: [
    status('claude', false),
    status('agy', true),
    status('codex', true),
    status('gemini-api', false),
  ],
  order: ['claude', 'agy', 'codex'],
  ...overrides,
});

describe('the AI badge in the top bar', () => {
  test('on Automatic, names the engine that would answer first: the first ready one', () => {
    const badge = aiBadge('auto', report());

    expect(badge).toMatchObject({ name: 'Antigravity', automatic: true, ready: true });
    expect(badge.summary).toBe('Automatic: Antigravity answers first.');
  });

  test('lists the answering engines in the order they are tried, each ready or not set up', () => {
    expect(aiBadge('auto', report()).lines).toEqual([
      { id: 'claude', name: 'Claude Code', ready: false, state: 'not set up' },
      { id: 'agy', name: 'Antigravity', ready: true, state: 'ready' },
      { id: 'codex', name: 'Codex', ready: true, state: 'ready' },
    ]);
  });

  test('counts an engine switched off in the settings as not set up, and lists it last', () => {
    const lines = aiBadge('auto', report({ order: ['codex', 'agy'] })).lines;

    expect(lines.map((line) => [line.id, line.state])).toEqual([
      ['codex', 'ready'],
      ['agy', 'ready'],
      ['claude', 'not set up'],
    ]);
  });

  test('names the chosen engine, and says when it is not set up', () => {
    expect(aiBadge('codex', report())).toMatchObject({
      name: 'Codex',
      automatic: false,
      ready: true,
      summary: 'Chosen: only Codex answers.',
    });
    expect(aiBadge('claude', report())).toMatchObject({
      name: 'Claude Code',
      ready: false,
      summary: 'Chosen: only Claude Code answers, and it is not set up.',
    });
  });

  test('says when no engine is ready, and while the server has not said', () => {
    const none = report({ engines: [status('claude', false)], order: ['claude'] });
    expect(aiBadge('auto', none)).toMatchObject({
      name: 'No AI ready',
      ready: false,
      summary: 'Automatic: no AI is set up on this computer.',
    });
    expect(aiBadge('auto', null)).toEqual({
      name: 'Checking',
      automatic: true,
      ready: false,
      summary: 'Checking which AI is set up on this computer.',
      lines: [],
    });
  });
});
