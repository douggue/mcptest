import { MAX_VIDEO_BYTES } from '@jgtube/core';
import { existsSync, mkdirSync, mkdtempSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { breakdownFiles } from '../src/breakdownFiles';
import type { DownloadVideo } from '../src/engines/videoWatch';

const VIDEO = 'dQw4w9WgXcQ';
const NO_PROGRAMS = { PATH: '' };

let root: string;
let own: string;
const never = new AbortController().signal;
const fetch: DownloadVideo = async () => ({ ok: false, reason: 'not used here' });

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'jgtube-bfiles-'));
  own = join(root, 'my-videos');
  mkdirSync(own);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const files = (env: Record<string, string> = NO_PROGRAMS) =>
  breakdownFiles({ root: () => root, fetch, stop: never, env });

const inMemory = () =>
  breakdownFiles({
    root: () => {
      throw new Error('This store is only in memory');
    },
    fetch,
    stop: never,
    env: NO_PROGRAMS,
  });

describe('breakdownFiles', () => {
  test('finds the owner’s own file in the my-videos folder, and says where that folder is', async () => {
    const mine = join(own, `Great title [${VIDEO}].mp4`);
    writeFileSync(mine, 'a video');

    expect(files().ownFolder()).toBe(own);
    expect(await files().own(VIDEO)).toBe(mine);
    expect(await files().own('aaaaaaaaaaa')).toBeNull();
  });

  test('has no folder and no files for a store that is only in memory', async () => {
    const none = inMemory();

    expect(none.ownFolder()).toBeNull();
    expect(await none.own(VIDEO)).toBeNull();
    expect(await none.cut(VIDEO, '/x.mp4')).toEqual({
      ok: false,
      reason: 'there is no downloads folder to cut into',
    });
    await expect(none.removeFrames(VIDEO)).resolves.toBeUndefined();
  });

  test('says whether frames can be cut by whether ffmpeg is found', async () => {
    const bin = mkdtempSync(join(root, 'bin-'));
    writeFileSync(join(bin, 'ffmpeg'), '', { mode: 0o755 });

    expect(await files().canCut()).toBe(false);
    expect(await files({ PATH: bin }).canCut()).toBe(true);
  });

  test('cuts from the owner’s folder as well as the temporary one, and says when ffmpeg is missing', async () => {
    const mine = join(own, `${VIDEO}.mp4`);
    writeFileSync(mine, 'a video');

    expect(await files().cut(VIDEO, mine)).toEqual({
      ok: false,
      reason: 'ffmpeg is not installed on this computer',
    });
    await expect(files().cut(VIDEO, join(root, 'elsewhere.mp4'))).rejects.toThrow(/outside/);
  });

  test('removes cut frames, and only those', async () => {
    const frames = join(root, 'video-temp', `frames-${VIDEO}`);
    mkdirSync(frames, { recursive: true });
    writeFileSync(join(frames, 'sheet-001.jpg'), 'x');
    const mine = join(own, `${VIDEO}.mp4`);
    writeFileSync(mine, 'a video');

    await files().removeFrames(VIDEO);

    expect(existsSync(frames)).toBe(false);
    expect(existsSync(mine)).toBe(true);
  });

  test('hands a file an engine can open over as it is, with nothing to remove', async () => {
    const mine = join(own, `${VIDEO}.mp4`);
    writeFileSync(mine, 'a small video');

    expect(await files().forWatching(VIDEO, mine)).toEqual({ ok: true, path: mine });
  });

  test('says a file is too large to open when no smaller copy can be made', async () => {
    const mine = join(own, `${VIDEO}.mp4`);
    writeFileSync(mine, '');
    // A file of the right size with nothing in it: no disk is filled to test a size.
    truncateSync(mine, MAX_VIDEO_BYTES + 5_000_000);

    const withoutFfmpeg = await files().forWatching(VIDEO, mine);
    const withoutFolder = await inMemory().forWatching(VIDEO, mine);

    expect(withoutFfmpeg).toEqual({
      ok: false,
      reason:
        'the file is 100 MB, more than the 95 MB an engine will open, and a smaller copy could not be made: ffmpeg is not installed on this computer',
    });
    expect(withoutFolder).toEqual({
      ok: false,
      reason: 'the file is 100 MB, more than the 95 MB an engine will open',
    });
    expect(existsSync(mine)).toBe(true);
  });
});
