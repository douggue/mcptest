import { describe, expect, test } from 'vitest';
import { pictureRoute, withStandIn } from '../src/pictureRoute';

const LABELS = { agy: 'Antigravity CLI', claude: 'Claude Code', codex: 'Codex CLI' } as const;
const label = (id: keyof typeof LABELS) => LABELS[id];
const ALL = ['claude', 'agy', 'codex'] as const;

describe('pictureRoute', () => {
  test('with no choice, is the engines that see pictures in the owner’s order', () => {
    expect(pictureRoute({ order: ALL, seeing: ['claude', 'codex'], label })).toEqual({
      engines: ['claude', 'codex'],
      ruledOut: [],
    });
  });

  test('with a chosen engine that can, tries it first and the others as stand-ins', () => {
    expect(pictureRoute({ order: ALL, seeing: ALL, only: 'agy', label })).toEqual({
      engines: ['agy', 'claude', 'codex'],
      ruledOut: [],
    });
  });

  test('with a chosen engine that failed the picture check, says why and goes on to the next', () => {
    const route = pictureRoute({ order: ALL, seeing: ['claude', 'codex'], only: 'agy', label });

    expect(route.engines).toEqual(['claude', 'codex']);
    expect(route.ruledOut).toEqual([
      {
        engine: 'agy',
        reason: 'failed',
        message: 'Antigravity CLI failed the picture check in Settings.',
      },
    ]);
  });

  test('leaves out an engine the owner asked to avoid, and one the settings leave out', () => {
    expect(
      pictureRoute({ order: ['agy', 'codex'], seeing: ALL, avoid: 'agy', label }).engines,
    ).toEqual(['codex']);
    expect(pictureRoute({ order: ['codex'], seeing: ALL, only: 'agy', label })).toEqual({
      engines: ['codex'],
      ruledOut: [
        {
          engine: 'agy',
          reason: 'not-installed',
          message: 'Antigravity CLI is left out by the JGTUBE_ENGINES setting.',
        },
      ],
    });
  });
});

describe('withStandIn', () => {
  const answer = {
    text: 'x',
    turns: 1,
    engine: 'claude' as const,
    skipped: [{ engine: 'agy' as const, reason: 'limit' as const, message: 'Out of allowance.' }],
  };

  test('says which engine wrote it in place of the chosen one, and why', () => {
    expect(withStandIn(answer, 'agy').standInFor).toEqual({
      engine: 'agy',
      because: 'Out of allowance.',
    });
  });

  test('adds nothing when the chosen engine wrote it, or none was chosen', () => {
    expect(withStandIn(answer, 'claude').standInFor).toBeUndefined();
    expect(withStandIn(answer, undefined).standInFor).toBeUndefined();
  });
});
