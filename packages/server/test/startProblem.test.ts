import { describe, expect, test } from 'vitest';
import { startProblem } from '../src/startProblem';

const failure = (code: string, message = 'listen failed'): NodeJS.ErrnoException =>
  Object.assign(new Error(message), { code });

describe('startProblem', () => {
  test('says Jgtube is probably running already when its port is taken, and what to do', () => {
    const text = startProblem(failure('EADDRINUSE'), '127.0.0.1', 4317);

    expect(text).toMatch(/already using port 4317/);
    expect(text).toMatch(/already running in another window/);
    expect(text).toContain('http://127.0.0.1:4317');
    expect(text).toMatch(/JGTUBE_PORT/);
  });

  test('says the port is not allowed when the computer refuses it', () => {
    expect(startProblem(failure('EACCES'), '127.0.0.1', 80)).toMatch(
      /does not allow it to use port 80/,
    );
  });

  test('gives the reason of any other failure', () => {
    expect(startProblem(failure('EOTHER', 'something odd'), '127.0.0.1', 4317)).toBe(
      'Jgtube could not start: something odd',
    );
  });
});
