import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { isWholeMp4 } from '../../src/engines/mp4';
import { box, tinyMp4 } from './standIn';

let folder: string;
beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'jgtube-mp4-test-'));
});
afterEach(() => rmSync(folder, { recursive: true, force: true }));

function file(bytes: Buffer): string {
  const path = join(folder, 'x.mp4');
  writeFileSync(path, bytes);
  return path;
}

/** A box whose length is written the long way, as eight bytes after the name. */
function longBox(name: string, body: Buffer): Buffer {
  const header = Buffer.alloc(16);
  header.writeUInt32BE(1, 0);
  header.write(name, 4, 'latin1');
  header.writeBigUInt64BE(BigInt(16 + body.length), 8);
  return Buffer.concat([header, body]);
}

describe('isWholeMp4', () => {
  test('is true for a file that starts with ftyp, has its index and ends where its boxes do', async () => {
    expect(await isWholeMp4(file(tinyMp4()))).toBe(true);
  });

  test('is true whichever side of the pictures the index is on', async () => {
    const indexLast = Buffer.concat([box('ftyp', 'isom'), box('mdat', 'pictures'), box('moov')]);

    expect(await isWholeMp4(file(indexLast))).toBe(true);
  });

  test('reads a box whose length is written the long way, and one that runs to the end', async () => {
    const long = Buffer.concat([
      box('ftyp', 'isom'),
      box('moov'),
      longBox('mdat', Buffer.alloc(40)),
    ]);
    const toEnd = Buffer.concat([box('ftyp', 'isom'), box('moov'), box('mdat', 'pictures')]);
    toEnd.writeUInt32BE(0, toEnd.length - 16);

    expect(await isWholeMp4(file(long))).toBe(true);
    expect(await isWholeMp4(file(toEnd))).toBe(true);
  });

  test('is false for a download that stopped part-way', async () => {
    const whole = tinyMp4();

    expect(await isWholeMp4(file(whole.subarray(0, whole.length - 5)))).toBe(false);
    expect(await isWholeMp4(file(whole.subarray(0, 20)))).toBe(false);
  });

  test('is false when the index never arrived', async () => {
    const noIndex = Buffer.concat([box('ftyp', 'isom'), box('mdat', 'pictures')]);

    expect(await isWholeMp4(file(noIndex))).toBe(false);
  });

  test('is false for something that is not an MP4 at all', async () => {
    expect(await isWholeMp4(file(Buffer.from('<html>Sign in to confirm your age</html>')))).toBe(
      false,
    );
    expect(await isWholeMp4(file(Buffer.concat([box('moov'), box('ftyp', 'isom')])))).toBe(false);
    expect(await isWholeMp4(file(Buffer.alloc(64)))).toBe(false);
    expect(await isWholeMp4(file(Buffer.alloc(0)))).toBe(false);
    expect(await isWholeMp4(file(longBox('ftyp', Buffer.alloc(0)).subarray(0, 12)))).toBe(false);
  });

  test('is false for a file that is not there', async () => {
    expect(await isWholeMp4(join(folder, 'gone.mp4'))).toBe(false);
  });
});
