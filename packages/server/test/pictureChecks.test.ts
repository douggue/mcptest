import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { pictureChecks, pictureChecksPath, type PictureCheckRecord } from '../src/pictureChecks';

let folder: string;
beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'jgtube-picture-checks-'));
});
afterEach(() => rmSync(folder, { recursive: true, force: true }));

const passed: PictureCheckRecord = {
  engine: 'agy',
  passed: true,
  answer: 'red, blue',
  shown: ['red', 'blue'],
  checkedAt: '2026-11-21T10:00:00.000Z',
};

describe('pictureChecksPath', () => {
  test('is a file beside a store on disk, and none for a store only in memory', () => {
    expect(pictureChecksPath('/data/jgtube.db')).toBe('/data/jgtube.db.picture-checks.json');
    expect(pictureChecksPath(':memory:')).toBeNull();
  });
});

describe('pictureChecks', () => {
  test('knows of no check before one is run, so nothing changes', () => {
    const checks = pictureChecks(join(folder, 'x.json'));
    expect(checks.all()).toEqual([]);
    expect(checks.passed()).toEqual([]);
  });

  test('keeps the last result per engine, in a file only the owner can read', () => {
    // Arrange
    const path = join(folder, 'x.json');
    const checks = pictureChecks(path);

    // Act
    checks.record({ ...passed, passed: false, answer: 'green, blue' });
    checks.record(passed);

    // Assert: a second instance reads what the first wrote.
    expect(pictureChecks(path).all()).toEqual([passed]);
    expect(pictureChecks(path).passed()).toEqual(['agy']);
    expect(statSync(path).mode & 0o077).toBe(0);
  });

  test('a later failure takes the engine back out', () => {
    const checks = pictureChecks(join(folder, 'x.json'));
    checks.record(passed);
    expect(checks.failed()).toEqual([]);
    checks.record({ ...passed, passed: false });
    expect(checks.passed()).toEqual([]);
    expect(checks.failed()).toEqual(['agy']);
  });

  test('treats a file that cannot be read, or holds anything else, as no check run', () => {
    const path = join(folder, 'x.json');
    writeFileSync(path, 'not json');
    expect(pictureChecks(path).all()).toEqual([]);
    expect(pictureChecks(path).failed()).toEqual([]);
    writeFileSync(path, JSON.stringify({ checks: [{ ...passed, engine: 'someone' }] }));
    expect(pictureChecks(path).passed()).toEqual([]);
  });

  test('keeps results in memory when the store is only in memory', () => {
    const checks = pictureChecks(null);
    checks.record(passed);
    expect(checks.passed()).toEqual(['agy']);
  });

  test('writes through a temporary file, leaving valid JSON', () => {
    const path = join(folder, 'x.json');
    pictureChecks(path).record(passed);
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ checks: [passed] });
  });
});
