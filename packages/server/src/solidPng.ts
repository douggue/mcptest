/**
 * A PNG of one solid colour, made in code: the picture check hands an engine
 * pictures whose content code knows, so its answer can be checked.
 * Uncompressed 8-bit RGB, one zlib stream, nothing else.
 */
import { deflateSync } from 'node:zlib';

export type Rgb = readonly [number, number, number];

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const BIT_DEPTH = 8;
const COLOUR_TYPE_RGB = 2;
const BYTES_PER_PIXEL = 3;
const MAX_SIDE = 2048;
/** The CRC-32 polynomial PNG uses, reversed. */
const CRC_POLYNOMIAL = 0xedb88320;

const CRC_TABLE: readonly number[] = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let bit = 0; bit < 8; bit += 1) {
    c = c & 1 ? CRC_POLYNOMIAL ^ (c >>> 1) : c >>> 1;
  }
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typed = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, crc]);
}

const isSide = (value: number): boolean =>
  Number.isInteger(value) && value >= 1 && value <= MAX_SIDE;

/** A `width` by `height` PNG filled with `rgb`. Throws for a size that is not 1 to 2048. */
export function solidPng(width: number, height: number, rgb: Rgb): Uint8Array {
  if (!isSide(width) || !isSide(height)) {
    throw new Error(`A picture's sides must be whole numbers from 1 to ${MAX_SIDE}`);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([BIT_DEPTH, COLOUR_TYPE_RGB, 0, 0, 0], 8);
  const row = Buffer.alloc(1 + width * BYTES_PER_PIXEL);
  for (let x = 0; x < width; x += 1) row.set(rgb, 1 + x * BYTES_PER_PIXEL);
  const pixels = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(pixels)),
    chunk('IEND', new Uint8Array()),
  ]);
}
