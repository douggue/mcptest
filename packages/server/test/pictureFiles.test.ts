import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  OPENED_LINE,
  filesLook,
  filesFromPaths,
  groupedFiles,
  picturesSeen,
} from '../src/pictureFiles';

const file = (name: string) => ({ name, bytes: new Uint8Array([1, 2]) });

describe('groupedFiles', () => {
  test('lists each group by its label with the files as @names, leaving out empty groups', () => {
    const set = groupedFiles([
      { label: 'top videos', files: [file('thumb-a.jpg'), file('thumb-b.jpg')] },
      { label: 'ordinary videos', files: [] },
      { label: 'the logo', files: [file('logo.jpg')] },
    ]);

    expect(set.files.map((entry) => entry.name)).toEqual([
      'thumb-a.jpg',
      'thumb-b.jpg',
      'logo.jpg',
    ]);
    expect(set.listing).toBe('top videos: @thumb-a.jpg @thumb-b.jpg; the logo: @logo.jpg');
  });

  test('is an empty set with a listing that says so when nothing is there', () => {
    expect(groupedFiles([{ label: 'x', files: [] }])).toEqual({ files: [], listing: 'none' });
  });
});

describe('filesLook', () => {
  test('names the files, asks for each to be opened, and asks for a line naming those opened', () => {
    const look = filesLook(groupedFiles([{ label: 'frames', files: [file('f-01.jpg')] }]));

    expect(look).toMatch(/files in your folder/);
    expect(look).toMatch(/frames: @f-01\.jpg/);
    expect(look).toContain(`${OPENED_LINE}:`);
  });
});

describe('picturesSeen', () => {
  const set = groupedFiles([
    { label: 'all', files: [file('thumb-aaaaaaaaaaa.jpg'), file('thumb-bbbbbbbbbbb.jpg')] },
  ]);

  test('counts the files an answer names, with or without the @', () => {
    expect(picturesSeen('PICTURES OPENED: thumb-aaaaaaaaaaa.jpg', set)).toEqual({
      shown: 2,
      named: 1,
    });
    expect(picturesSeen('I opened @thumb-bbbbbbbbbbb.jpg and @THUMB-AAAAAAAAAAA.JPG', set)).toEqual(
      { shown: 2, named: 2 },
    );
  });

  test('finds none when the answer names no file it was given', () => {
    expect(picturesSeen('The thumbnails are bold and red.', set)).toEqual({ shown: 2, named: 0 });
  });
});

describe('filesFromPaths', () => {
  let folder = '';
  afterEach(() => rmSync(folder, { recursive: true, force: true }));

  test('reads each picture under the name made in code and skips one that cannot be read', async () => {
    folder = mkdtempSync(join(tmpdir(), 'jgtube-picture-files-'));
    writeFileSync(join(folder, 'k-001.jpg'), Buffer.from([0xff, 0xd8, 1]));

    const set = await filesFromPaths([
      {
        label: 'video 1, keyframes',
        pictures: [
          { name: 'v1-k-001.jpg', path: join(folder, 'k-001.jpg') },
          { name: 'v1-k-002.jpg', path: join(folder, 'missing.jpg') },
        ],
      },
    ]);

    expect(set.files).toEqual([{ name: 'v1-k-001.jpg', bytes: new Uint8Array([0xff, 0xd8, 1]) }]);
    expect(set.listing).toBe('video 1, keyframes: @v1-k-001.jpg');
  });
});
