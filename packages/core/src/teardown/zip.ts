import { crc32 } from 'node:zlib';

/**
 * A plain ZIP archive, files stored without compression (pictures are
 * already compressed): enough to hand over a teardown folder as one download.
 * Names are checked to be simple relative paths.
 */

export interface ZipEntry {
  readonly name: string;
  readonly bytes: Uint8Array;
}

const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;
const END = 0x06054b50;
const VERSION = 20;
const UTF8_FLAG = 0x0800;
const SAFE_NAME = /^(?:[\w.-]+\/)?[\w.-]+$/;

function header(size: number, write: (view: DataView) => void): Buffer {
  const buffer = Buffer.alloc(size);
  write(new DataView(buffer.buffer, buffer.byteOffset, size));
  return buffer;
}

export function zipFiles(entries: readonly ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    if (!SAFE_NAME.test(entry.name) || entry.name.includes('..'))
      throw new Error('Not a safe name in an archive');
    const name = Buffer.from(entry.name, 'utf8');
    const crc = crc32(entry.bytes);
    const size = entry.bytes.length;
    const local = header(30, (view) => {
      view.setUint32(0, LOCAL, true);
      view.setUint16(4, VERSION, true);
      view.setUint16(6, UTF8_FLAG, true);
      view.setUint32(14, crc, true);
      view.setUint32(18, size, true);
      view.setUint32(22, size, true);
      view.setUint16(26, name.length, true);
    });
    const central = header(46, (view) => {
      view.setUint32(0, CENTRAL, true);
      view.setUint16(4, VERSION, true);
      view.setUint16(6, VERSION, true);
      view.setUint16(8, UTF8_FLAG, true);
      view.setUint32(16, crc, true);
      view.setUint32(20, size, true);
      view.setUint32(24, size, true);
      view.setUint16(28, name.length, true);
      view.setUint32(42, offset, true);
    });
    locals.push(local, name, Buffer.from(entry.bytes));
    centrals.push(central, name);
    offset += local.length + name.length + size;
  }
  const directory = Buffer.concat(centrals);
  const end = header(22, (view) => {
    view.setUint32(0, END, true);
    view.setUint16(8, entries.length, true);
    view.setUint16(10, entries.length, true);
    view.setUint32(12, directory.length, true);
    view.setUint32(16, offset, true);
  });
  return Buffer.concat([...locals, directory, end]);
}
