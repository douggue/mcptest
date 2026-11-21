import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { SETTINGS_FILE } from '../../src/engines/agy';
import { allowAntigravity } from '../../src/engines/allowAgy';

const SERVER = 'jgtube';
let home: string;
let file: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'jgtube-allow-'));
  file = join(home, ...SETTINGS_FILE);
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

const allowed = (): unknown => JSON.parse(readFileSync(file, 'utf8')).permissions.allow;

describe('allowAntigravity', () => {
  test('makes the settings file with the one rule when there is none', () => {
    const report = allowAntigravity(SERVER, home);

    expect(report.ok).toBe(true);
    expect(allowed()).toEqual([`mcp(${SERVER}/*)`]);
    expect(report.lines.join(' ')).toMatch(/one line was added/);
    expect(existsSync(`${file}.before-jgtube`)).toBe(false);
  });

  test('adds the rule to settings that are there, keeping a copy of them the first time', () => {
    mkdirSync(dirname(file), { recursive: true });
    const before = JSON.stringify({ theme: 'dark', permissions: { allow: ['other'] } });
    writeFileSync(file, before);

    const report = allowAntigravity(SERVER, home);

    expect(report.ok).toBe(true);
    expect(allowed()).toEqual(['other', `mcp(${SERVER}/*)`]);
    expect(readFileSync(`${file}.before-jgtube`, 'utf8')).toBe(before);
    expect(report.lines[0]).toMatch(/kept in/);
  });

  test('changes nothing the second time', () => {
    allowAntigravity(SERVER, home);
    const after = readFileSync(file, 'utf8');

    const report = allowAntigravity(SERVER, home);

    expect(report.ok).toBe(true);
    expect(report.lines.join(' ')).toMatch(/already/);
    expect(readFileSync(file, 'utf8')).toBe(after);
  });

  test('leaves settings it cannot read alone and says so', () => {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, '{ not json');

    const report = allowAntigravity(SERVER, home);

    expect(report.ok).toBe(false);
    expect(report.lines[0]).toMatch(/Nothing was changed/);
    expect(readFileSync(file, 'utf8')).toBe('{ not json');
  });
});
