/**
 * A Format Bible's palette as one PNG strip, made in code: each measured
 * colour as wide as its share. Uncompressed 8-bit RGB rows in one zlib stream.
 */
import { crc32, deflateSync } from 'node:zlib';

export const PALETTE_STRIP_WIDTH = 600;
export const PALETTE_STRIP_HEIGHT = 80;

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const BIT_DEPTH = 8;
const COLOUR_TYPE_RGB = 2;
const BYTES_PER_PIXEL = 3;
const HEX = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;

export interface StripColour {
  readonly hex: string;
  readonly share: number;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typed = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, crc]);
}

const rgbOf = (hex: string): readonly [number, number, number] => {
  const match = HEX.exec(hex);
  if (match === null) throw new Error(`Not a hex colour: ${hex}`);
  return [parseInt(match[1]!, 16), parseInt(match[2]!, 16), parseInt(match[3]!, 16)];
};

/** The strip; throws for no colours or one that is not a #RRGGBB code. */
export function palettePng(colours: readonly StripColour[]): Uint8Array {
  if (colours.length === 0) throw new Error('A palette strip needs a colour');
  const rgbs = colours.map((colour) => rgbOf(colour.hex));
  const total = colours.reduce((sum, colour) => sum + Math.max(0, colour.share), 0) || 1;
  const row = Buffer.alloc(1 + PALETTE_STRIP_WIDTH * BYTES_PER_PIXEL);
  let start = 0;
  let sum = 0;
  colours.forEach((colour, index) => {
    sum += Math.max(0, colour.share);
    const end =
      index === colours.length - 1
        ? PALETTE_STRIP_WIDTH
        : Math.round((sum / total) * PALETTE_STRIP_WIDTH);
    for (let x = start; x < end; x += 1) row.set(rgbs[index]!, 1 + x * BYTES_PER_PIXEL);
    start = end;
  });
  const header = Buffer.alloc(13);
  header.writeUInt32BE(PALETTE_STRIP_WIDTH, 0);
  header.writeUInt32BE(PALETTE_STRIP_HEIGHT, 4);
  header.set([BIT_DEPTH, COLOUR_TYPE_RGB, 0, 0, 0], 8);
  const pixels = Buffer.concat(Array.from({ length: PALETTE_STRIP_HEIGHT }, () => row));
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(pixels)),
    chunk('IEND', new Uint8Array()),
  ]);
}
