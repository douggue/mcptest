import { describe, expect, test } from 'vitest';
import { EngineRunError } from '../../src/engines/failure';
import { firstAnswer, type Attempt } from '../../src/engines/fallback';
import type { EngineFailure, EngineId } from '../../src/engines/types';

const answers = (engine: EngineId, text: string, ran: EngineId[] = []): Attempt<EngineId> => ({
  engine,
  run: async () => {
    ran.push(engine);
    return { text, turns: 2 };
  },
});

const fails = (
  engine: EngineId,
  reason: EngineFailure,
  message: string,
  ran: EngineId[] = [],
): Attempt<EngineId> => ({
  engine,
  run: async () => {
    ran.push(engine);
    throw new EngineRunError(reason, message);
  },
});

const NOBODY = 'No engine could answer.';

describe('firstAnswer', () => {
  test('takes the first engine’s answer and tries no other', async () => {
    const ran: EngineId[] = [];

    await expect(
      firstAnswer([answers('agy', 'From Antigravity.', ran), answers('claude', 'x', ran)], NOBODY),
    ).resolves.toEqual({ text: 'From Antigravity.', turns: 2, engine: 'agy', skipped: [] });
    expect(ran).toEqual(['agy']);
  });

  const EVERY_FAILURE: readonly EngineFailure[] = [
    'not-installed',
    'not-signed-in',
    'limit',
    'timeout',
    'failed',
  ];

  test.each(EVERY_FAILURE)('moves on from an engine that is %s, and says so', async (reason) => {
    const result = await firstAnswer(
      [fails('agy', reason, 'Antigravity cannot run.'), answers('claude', 'From Claude.')],
      NOBODY,
    );

    expect(result).toEqual({
      text: 'From Claude.',
      turns: 2,
      engine: 'claude',
      skipped: [{ engine: 'agy', reason, message: 'Antigravity cannot run.' }],
    });
  });

  test('ends the whole attempt, trying nobody else, once Jgtube is closing', async () => {
    const ran: EngineId[] = [];
    const pending = firstAnswer(
      [
        fails('agy', 'not-installed', 'Antigravity is not installed.', ran),
        fails('claude', 'failed', 'Claude was stopped because Jgtube is closing.', ran),
        answers('codex', 'never', ran),
      ],
      NOBODY,
      () => ran.includes('claude'),
    );

    await expect(pending).rejects.toMatchObject({
      reason: 'failed',
      message: 'Claude was stopped because Jgtube is closing.',
      skipped: [{ engine: 'agy', reason: 'not-installed' }],
    });
    expect(ran).toEqual(['agy', 'claude']);
  });

  test('reports a timeout ahead of a plain failure when nobody answered', async () => {
    const pending = firstAnswer(
      [
        fails('agy', 'failed', 'Antigravity stopped.'),
        fails('claude', 'timeout', 'Claude took too long.'),
        fails('codex', 'not-installed', 'Codex is not installed.'),
      ],
      NOBODY,
    );

    await expect(pending).rejects.toMatchObject({
      reason: 'timeout',
      message:
        'No engine could answer. Antigravity stopped. Claude took too long. Codex is not installed.',
    });
  });

  test('when every engine is passed over, says why for each, most telling reason first', async () => {
    const pending = firstAnswer(
      [
        fails('agy', 'not-installed', 'Antigravity is not installed.'),
        fails('claude', 'limit', 'Claude has hit its limit.'),
        fails('codex', 'not-signed-in', 'Nobody is signed in to Codex.'),
      ],
      NOBODY,
    );

    await expect(pending).rejects.toMatchObject({
      reason: 'limit',
      message:
        'No engine could answer. Antigravity is not installed. Claude has hit its limit. Nobody is signed in to Codex.',
    });
    await expect(pending).rejects.toMatchObject({
      skipped: [{ engine: 'agy' }, { engine: 'claude' }, { engine: 'codex' }],
    });
  });

  test('notes an engine ruled out beforehand only when its turn comes', async () => {
    const ruledOut = { engine: 'agy', reason: 'failed', message: 'No file to watch.' } as const;

    await expect(firstAnswer([ruledOut, answers('claude', 'ok')], NOBODY)).resolves.toMatchObject({
      engine: 'claude',
      skipped: [ruledOut],
    });
    await expect(firstAnswer([answers('claude', 'ok'), ruledOut], NOBODY)).resolves.toMatchObject({
      engine: 'claude',
      skipped: [],
    });
    await expect(firstAnswer([ruledOut], NOBODY)).rejects.toMatchObject({
      reason: 'failed',
      message: 'No engine could answer. No file to watch.',
    });
  });

  test('with nothing to try, says nobody could', async () => {
    await expect(firstAnswer([], NOBODY)).rejects.toMatchObject({
      reason: 'not-installed',
      message: NOBODY,
      skipped: [],
    });
  });

  test('passes over an engine that breaks in a way of its own, without showing a file path', async () => {
    const broken: Attempt<EngineId> = {
      engine: 'agy',
      run: async () => {
        throw new Error('EBUSY: resource busy, rmdir /tmp/jgtube-engines-x1/agy/run-1');
      },
    };

    const result = await firstAnswer([broken, answers('claude', 'From Claude.')], NOBODY);

    expect(result.engine).toBe('claude');
    expect(result.skipped).toEqual([
      { engine: 'agy', reason: 'failed', message: expect.stringMatching(/error of its own/) },
    ]);
    expect(result.skipped[0]?.message).not.toContain('/tmp/jgtube-engines');
  });
});
