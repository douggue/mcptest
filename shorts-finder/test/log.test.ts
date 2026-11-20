import { describe, expect, test, vi } from 'vitest';
import { createLogger } from '../src/log';
import { NOW } from './fixtures/facts';

const KEY = 'test-key-not-a-real-one-0123456789';
const TOKEN = '1234567890:TEST-token-not-a-real-one-0123456789';

function capture(secrets: readonly string[] = []) {
  const lines: string[] = [];
  const log = createLogger({ secrets, now: () => NOW, write: (line) => lines.push(line) });
  return { lines, log };
}

describe('the logger', () => {
  test('writes one line of JSON an event, with the time, the level and the fields', () => {
    const { lines, log } = capture();

    log.info('cycle', { cycle: 'read', report: { read: 3 } });

    expect(lines).toHaveLength(1);
    expect(lines[0]?.endsWith('\n')).toBe(true);
    expect(JSON.parse(lines[0] ?? '')).toEqual({
      time: '2026-11-20T20:00:00.000Z',
      level: 'info',
      event: 'cycle',
      cycle: 'read',
      report: { read: 3 },
    });
  });

  test('keeps text with line breaks on one line', () => {
    const { lines, log } = capture();

    log.warn('odd', { reason: 'first\nsecond' });

    expect(lines[0]?.trimEnd()).not.toContain('\n');
    expect(JSON.parse(lines[0] ?? '').level).toBe('warn');
  });

  test('takes the key and the token out of every line, wherever they appear', () => {
    const { lines, log } = capture([KEY, TOKEN]);

    log.error('failed', {
      reason: `GET https://api.telegram.org/bot${TOKEN}/sendMessage with ${KEY}`,
      nested: { deep: [KEY] },
    });

    expect(lines[0]).not.toContain(KEY);
    expect(lines[0]).not.toContain('TEST-token');
    expect(JSON.parse(lines[0] ?? '').nested).toEqual({ deep: ['[secret]'] });
  });

  test('takes out anything shaped like a bot token, even one it was not told of', () => {
    const { lines, log } = capture();

    log.info('note', { text: 'bot99999999:another-token-shaped-string-0123456789' });

    expect(lines[0]).not.toContain('another-token');
  });

  test('does not blank out ordinary words for a "secret" too short to be one', () => {
    const { lines, log } = capture(['', 'read']);

    log.info('cycle', { cycle: 'read' });

    expect(JSON.parse(lines[0] ?? '').cycle).toBe('read');
  });

  test('still writes the event when its fields cannot be written as JSON', () => {
    const { lines, log } = capture();
    const loop: Record<string, unknown> = {};
    loop.self = loop;

    log.info('odd', { loop });

    expect(JSON.parse(lines[0] ?? '')).toMatchObject({ event: 'odd', unwritable: true });
  });

  test('writes to standard output, with the time of the moment, when given nothing else', () => {
    const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true);

    createLogger().info('started');

    const line = String(write.mock.calls[0]?.[0]);
    write.mockRestore();
    expect(JSON.parse(line)).toMatchObject({ level: 'info', event: 'started' });
    expect(Number.isFinite(Date.parse(JSON.parse(line).time))).toBe(true);
  });
});
