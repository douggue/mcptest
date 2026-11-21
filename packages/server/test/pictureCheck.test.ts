import { inflateSync } from 'node:zlib';
import { describe, expect, test } from 'vitest';
import {
  CHECK_COLOURS,
  checkPictureAnswer,
  pickColours,
  type CheckColour,
  pictureCheckRequest,
} from '../src/pictureCheck';
import { solidPng } from '../src/solidPng';

/** A colour of the list by place; the list is fixed, so a miss is a broken test. */
function at(index: number): CheckColour {
  const colour = CHECK_COLOURS[index];
  if (!colour) throw new Error('no such colour');
  return colour;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** The chunks of a PNG, by type, with their data. */
function chunks(png: Uint8Array): ReadonlyMap<string, Buffer> {
  const buffer = Buffer.from(png);
  const found = new Map<string, Buffer>();
  let at = PNG_SIGNATURE.length;
  while (at < buffer.length) {
    const length = buffer.readUInt32BE(at);
    const type = buffer.toString('latin1', at + 4, at + 8);
    found.set(type, buffer.subarray(at + 8, at + 8 + length));
    at += 12 + length;
  }
  return found;
}

describe('solidPng', () => {
  test('makes a valid PNG of the given size filled with one colour', () => {
    // Arrange
    const rgb = [0x12, 0x80, 0xfe] as const;

    // Act
    const png = solidPng(4, 3, rgb);

    // Assert
    expect([...png.subarray(0, 8)]).toEqual(PNG_SIGNATURE);
    const parts = chunks(png);
    const header = parts.get('IHDR');
    expect(header?.readUInt32BE(0)).toBe(4);
    expect(header?.readUInt32BE(4)).toBe(3);
    expect(header?.[8]).toBe(8);
    expect(header?.[9]).toBe(2);
    const pixels = inflateSync(parts.get('IDAT') ?? Buffer.alloc(0));
    expect(pixels.length).toBe(3 * (1 + 4 * 3));
    for (let row = 0; row < 3; row += 1) {
      const line = pixels.subarray(row * 13, row * 13 + 13);
      expect(line[0]).toBe(0);
      expect([...line.subarray(1, 4)]).toEqual([...rgb]);
      expect([...line.subarray(10, 13)]).toEqual([...rgb]);
    }
    expect(parts.has('IEND')).toBe(true);
  });

  test('writes the checksum of each chunk so image readers accept it', () => {
    // Known CRC of the empty IEND chunk.
    const png = Buffer.from(solidPng(1, 1, [0, 0, 0]));
    expect(png.subarray(-4).toString('hex')).toBe('ae426082');
  });

  test('refuses a size that is not a small whole number', () => {
    expect(() => solidPng(0, 1, [0, 0, 0])).toThrow();
    expect(() => solidPng(1.5, 1, [0, 0, 0])).toThrow();
    expect(() => solidPng(5000, 1, [0, 0, 0])).toThrow();
  });
});

describe('pickColours', () => {
  test('picks two different colours from the fixed list', () => {
    // Arrange: a stand-in for Math.random that walks through the list.
    const draws = [0, 0.99];
    const random = (): number => draws.shift() ?? 0;

    // Act
    const picked = pickColours(random);

    // Assert: the second is drawn from the other seven, so the two always differ.
    expect(picked.map((colour) => colour.name)).toEqual([
      CHECK_COLOURS[0]?.name,
      CHECK_COLOURS.at(-1)?.name,
    ]);
  });

  test('the list holds eight clearly different colours with distinct names', () => {
    expect(CHECK_COLOURS).toHaveLength(8);
    expect(new Set(CHECK_COLOURS.map((colour) => colour.name)).size).toBe(8);
    expect(new Set(CHECK_COLOURS.map((colour) => colour.rgb.join())).size).toBe(8);
  });
});

describe('pictureCheckRequest', () => {
  const settings = { projectRoot: '/app', dbPath: '/data/j.db', workDir: '/tmp/run' };

  test('hands two PNG files and asks for their colours only, with no tools', () => {
    // Arrange
    const colours = [at(1), at(2)] as const;

    // Act
    const request = pictureCheckRequest(colours, settings);

    // Assert
    expect(request.files?.map((file) => file.name)).toEqual(['picture-1.png', 'picture-2.png']);
    expect(request.prompt).toContain('@picture-1.png');
    expect(request.prompt).toContain('@picture-2.png');
    expect(request.mcpServers).toEqual({});
    expect(request.allowedTools).toEqual([]);
    expect(request.cwd).toBe('/tmp/run');
    // The answer is in the pictures, never in the words.
    for (const colour of CHECK_COLOURS) expect(request.prompt).not.toContain(colour.name);
  });
});

describe('checkPictureAnswer', () => {
  const shown = [at(0), at(3)] as const;
  const names = shown.map((colour) => colour.name);

  test('passes when both colours are named in order', () => {
    expect(checkPictureAnswer(`${names[0]}, ${names[1]}`, shown)).toBe(true);
    expect(checkPictureAnswer(`  ${names[0]?.toUpperCase()}\n${names[1]}.`, shown)).toBe(true);
  });

  test('takes common other words for the same colour', () => {
    const grey = CHECK_COLOURS.find((colour) => colour.name === 'grey');
    const purple = CHECK_COLOURS.find((colour) => colour.name === 'purple');
    if (!grey || !purple) throw new Error('fixture colours missing');
    expect(checkPictureAnswer('Gray, Violet', [grey, purple])).toBe(true);
  });

  test('fails when a colour is wrong, missing, swapped or an extra one is named', () => {
    expect(checkPictureAnswer(`${names[0]}`, shown)).toBe(false);
    expect(checkPictureAnswer(`${names[1]}, ${names[0]}`, shown)).toBe(false);
    expect(checkPictureAnswer(`${names[0]}, ${names[1]}, ${CHECK_COLOURS[5]?.name}`, shown)).toBe(
      false,
    );
    expect(checkPictureAnswer('I cannot see any pictures.', shown)).toBe(false);
  });
});
