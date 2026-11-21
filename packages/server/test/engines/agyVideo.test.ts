import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  truncateSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  MAX_VIDEO_BYTES,
  WATCH_TIMEOUT_MS,
  buildAgyVideoArgs,
  watchLinkWithAgy,
  watchWithAgy,
} from '../../src/engines/agyVideo';
import type { VideoQuestion, VideoWatchRequest } from '../../src/engines/types';
import { harness, scripted, tinyMp4, type Scripted, type Started } from './standIn';

let folder: string;
let work: string;
beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'jgtube-video-test-'));
  work = join(folder, 'work');
});
afterEach(() => rmSync(folder, { recursive: true, force: true }));

/** A stand-in video file: the outline of a whole MP4, which is all that is checked here. */
function videoFile(name = 'downloaded video (1).MP4', bytes: Buffer | string = tinyMp4()): string {
  const path = join(folder, name);
  writeFileSync(path, bytes);
  return path;
}

const question = (): VideoQuestion => ({
  question: 'Say second by second what happens, including on-screen text and sounds.',
  systemPrompt: 'You are a YouTube analyst.',
  timeoutMs: WATCH_TIMEOUT_MS,
  cwd: work,
});
const request = (videoPath: string): VideoWatchRequest => ({ ...question(), videoPath });

const success = (response: string): string => JSON.stringify({ status: 'SUCCESS', response });
const agy = (reply: Scripted | ((start: Started) => Scripted)) =>
  scripted(typeof reply === 'function' ? reply : () => reply);

describe('buildAgyVideoArgs', () => {
  test('asks for one answer as JSON with a time limit, as the owner’s own command does, and fenced in', () => {
    expect(buildAgyVideoArgs('Watch @clip.mp4', WATCH_TIMEOUT_MS)).toEqual([
      '-p',
      'Watch @clip.mp4',
      '--output-format',
      'json',
      '--sandbox',
      '--print-timeout',
      '12m',
    ]);
    expect(buildAgyVideoArgs('x', 60_000, 'Gemini 3.8 Flash').slice(-2)).toEqual([
      '--model',
      'Gemini 3.8 Flash',
    ]);
  });

  test('never skips permissions and never opens another folder', () => {
    const args = buildAgyVideoArgs('x', 60_000, 'm');

    expect(args).not.toContain('--dangerously-skip-permissions');
    expect(args).not.toContain('--add-dir');
  });
});

describe('watchWithAgy', () => {
  test('puts a copy of the file in the run’s own folder under a fixed name and asks about that', async () => {
    const original = videoFile();
    let seen: { files: readonly string[]; copy: Buffer } | null = null;
    const { started, deps } = agy((start) => {
      seen = { files: readdirSync(start.cwd), copy: readFileSync(join(start.cwd, 'clip.mp4')) };
      return { stdout: success('0:00 a title card. 0:03 a drum hit.') };
    });

    await expect(watchWithAgy(request(original), deps)).resolves.toEqual({
      text: '0:00 a title card. 0:03 a drum hit.',
      turns: null,
    });
    expect(seen).toEqual({ files: ['clip.mp4'], copy: tinyMp4() });
    const prompt = started[0]?.args[1] ?? '';
    expect(prompt).toContain('@clip.mp4');
    expect(prompt).toContain('You are a YouTube analyst.');
    expect(prompt).toContain('Say second by second what happens');
    // Nothing from outside reaches the prompt: not the file's name, not its folder.
    expect(prompt).not.toContain('downloaded video');
    expect(prompt).not.toContain(folder);
    expect(started[0]?.cwd.startsWith(join(work, 'run-'))).toBe(true);
  });

  test('removes its copy afterwards and leaves the original alone', async () => {
    const original = videoFile('a.mp4');
    await watchWithAgy(request(original), agy({ stdout: success('ok') }).deps);
    await watchWithAgy(request(original), agy({ stdout: '', code: 1 }).deps).catch(() => undefined);

    expect(readdirSync(work)).toEqual([]);
    expect(readFileSync(original)).toEqual(tinyMp4());
  });

  test.each(['x.mkv', 'x.mov', 'x.webm', 'x.mp4.exe', 'x'])(
    'refuses %s before starting anything',
    async (name) => {
      const { started, deps } = agy({ stdout: success('never') });

      await expect(watchWithAgy(request(videoFile(name)), deps)).rejects.toMatchObject({
        reason: 'failed',
        message: expect.stringMatching(/only given MP4 files/),
      });
      expect(started).toEqual([]);
    },
  );

  test('refuses a file larger than Antigravity can open, before copying it', async () => {
    const big = videoFile('big.mp4', '');
    // A file of that size with nothing in it takes no room on the disk.
    truncateSync(big, MAX_VIDEO_BYTES + 1);
    const { started, deps } = agy({ stdout: success('never') });

    await expect(watchWithAgy(request(big), deps)).rejects.toMatchObject({
      reason: 'failed',
      message: expect.stringMatching(/larger than 95 MB/),
    });
    expect(started).toEqual([]);
    expect(existsSync(work)).toBe(false);
  });

  test('never hands over a download that stopped part-way', async () => {
    const whole = tinyMp4();
    const partial = videoFile('partial.mp4', whole.subarray(0, whole.length - 4));
    const { started, deps } = agy({ stdout: success('never') });

    await expect(watchWithAgy(request(partial), deps)).rejects.toMatchObject({
      reason: 'failed',
      message: expect.stringMatching(/not a complete MP4/),
    });
    expect(started).toEqual([]);
  });

  test('refuses a file that is missing, empty or a folder', async () => {
    const { deps } = agy({ stdout: success('never') });
    mkdirSync(join(folder, 'folder.mp4'));

    await expect(watchWithAgy(request(join(folder, 'gone.mp4')), deps)).rejects.toMatchObject({
      reason: 'failed',
      message: expect.stringMatching(/could not be found/),
    });
    await expect(watchWithAgy(request(videoFile('empty.mp4', '')), deps)).rejects.toMatchObject({
      message: expect.stringMatching(/not a complete MP4/),
    });
    await expect(watchWithAgy(request(join(folder, 'folder.mp4')), deps)).rejects.toMatchObject({
      message: expect.stringMatching(/could not be found/),
    });
  });

  test('says nobody is signed in, or that Antigravity is not installed', async () => {
    const original = videoFile();
    const signedOut = agy({ stdout: '', stderr: 'authentication required', code: 1 });
    const missing = agy({ startError: 'ENOENT' });

    await expect(watchWithAgy(request(original), signedOut.deps)).rejects.toMatchObject({
      reason: 'not-signed-in',
    });
    await expect(watchWithAgy(request(original), missing.deps)).rejects.toMatchObject({
      reason: 'not-installed',
    });
  });

  test('says the video may be too long when the run times out', async () => {
    const byAgy = agy({
      stdout: JSON.stringify({ status: 'ERROR', error: 'timed out after 12m' }),
      code: 3,
    });
    const { deps } = harness();
    const stopped = watchWithAgy({ ...request(videoFile()), timeoutMs: -14_990 }, deps);

    await expect(watchWithAgy(request(videoFile()), byAgy.deps)).rejects.toMatchObject({
      reason: 'timeout',
      message: expect.stringMatching(/too long to watch in one pass/),
    });
    await expect(stopped).rejects.toMatchObject({
      reason: 'timeout',
      message: expect.stringMatching(/stopped.*too long to watch in one pass/),
    });
  });

  test('does not take a refused action for a failure: there are no tools to refuse', async () => {
    const { deps } = agy({
      stdout: success('It opens on a map.'),
      stderr: 'Permission denied (soft): mcp other/tool\n',
    });

    await expect(watchWithAgy(request(videoFile()), deps)).resolves.toMatchObject({
      text: 'It opens on a map.',
    });
  });
});

describe('watchLinkWithAgy', () => {
  test('asks about the link built from the video id, in an empty folder of its own', async () => {
    let files: readonly string[] | null = null;
    const { started, deps } = agy((start) => {
      files = readdirSync(start.cwd);
      return { stdout: success('The first sentence spoken is "Welcome back".') };
    });

    await expect(
      watchLinkWithAgy({ ...question(), videoId: 'dQw4w9WgXcQ' }, deps),
    ).resolves.toMatchObject({ text: 'The first sentence spoken is "Welcome back".' });
    expect(files).toEqual([]);
    expect(started[0]?.args[1]).toContain(
      'the YouTube video at https://www.youtube.com/watch?v=dQw4w9WgXcQ ',
    );
    expect(readdirSync(work)).toEqual([]);
  });

  test.each(['', 'short', 'dQw4w9WgXcQ&list=x', 'https://evil.example/x', '../../etc/passwd'])(
    'refuses %j, which is not a video id',
    async (videoId) => {
      const { started, deps } = agy({ stdout: success('never') });

      await expect(watchLinkWithAgy({ ...question(), videoId }, deps)).rejects.toMatchObject({
        reason: 'failed',
        message: expect.stringMatching(/video id/),
      });
      expect(started).toEqual([]);
    },
  );
});
