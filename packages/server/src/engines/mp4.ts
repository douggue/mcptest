/**
 * Whether an MP4 file is all there. A download that stopped part-way leaves a
 * file that looks like a video but ends mid-way, and the Antigravity CLI has
 * hung on such files before. An MP4 is a row of boxes, each starting with its
 * own length and a four-letter name; a whole file starts with `ftyp`, holds a
 * `moov` (the index), and its boxes add up to exactly its size. Only the box
 * headers are read, so this costs a few short reads whatever the file's size.
 */
import { open, type FileHandle } from 'node:fs/promises';

const HEADER_BYTES = 8;
const LARGE_HEADER_BYTES = 16;
/** A length of 1 means the real length follows as eight bytes; 0 means "to the end of the file". */
const LENGTH_FOLLOWS = 1;
const TO_END_OF_FILE = 0;
/** No real file has anywhere near this many top-level boxes; more means it is not an MP4. */
const MAX_BOXES = 10_000;
/** The index and the pictures and sound themselves: a file with either missing cannot be played. */
const REQUIRED_BOXES = ['moov', 'mdat'] as const;

interface Box {
  readonly name: string;
  readonly length: number;
}

/** The box that starts at `offset`, or null when the file ends before its header does. */
async function boxAt(file: FileHandle, offset: number, fileSize: number): Promise<Box | null> {
  const header = Buffer.alloc(LARGE_HEADER_BYTES);
  const { bytesRead } = await file.read(header, 0, LARGE_HEADER_BYTES, offset);
  if (bytesRead < HEADER_BYTES) return null;
  const name = header.toString('latin1', 4, HEADER_BYTES);
  const short = header.readUInt32BE(0);
  if (short === TO_END_OF_FILE) return { name, length: fileSize - offset };
  if (short !== LENGTH_FOLLOWS) return { name, length: short };
  if (bytesRead < LARGE_HEADER_BYTES) return null;
  return { name, length: Number(header.readBigUInt64BE(HEADER_BYTES)) };
}

/** The names of the file's top-level boxes, or null when they do not fill the file exactly. */
async function boxNames(file: FileHandle, fileSize: number): Promise<readonly string[] | null> {
  let names: readonly string[] = [];
  let offset = 0;
  while (offset < fileSize) {
    const box = await boxAt(file, offset, fileSize);
    if (box === null || box.length < HEADER_BYTES || names.length >= MAX_BOXES) return null;
    names = [...names, box.name];
    offset += box.length;
  }
  return offset === fileSize ? names : null;
}

/** True when the file is an MP4 with its index and nothing missing from its end. Never throws. */
export async function isWholeMp4(path: string): Promise<boolean> {
  let file: FileHandle | null = null;
  try {
    file = await open(path, 'r');
    const names = await boxNames(file, (await file.stat()).size);
    return (
      names !== null && names[0] === 'ftyp' && REQUIRED_BOXES.every((name) => names.includes(name))
    );
  } catch {
    return false;
  } finally {
    await file?.close();
  }
}
