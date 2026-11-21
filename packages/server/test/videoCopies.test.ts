import type { VideoDownload as FetchedVideo } from '@jgtube/core';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { videoCopies, type FetchVideoFile } from '../src/videoCopies';

const VIDEO = 'dQw4w9WgXcQ';
const DASHED = '-aaaaaaaaaa';
const never = new AbortController().signal;

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'jgtube-copies-'));
  mkdirSync(join(root, 'video-temp'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** A stand-in for core's downloader: it writes a small file where the real one would. */
const writes: FetchVideoFile = async (videoId) => {
  const path = join(root, 'video-temp', `${videoId}.mp4`);
  writeFileSync(path, 'a video');
  return { ok: true, path, bytes: 7, durationSeconds: 60, format: '360p mp4', via: 'yt-dlp' };
};

const fails =
  (answer: FetchedVideo): FetchVideoFile =>
  async () =>
    answer;

describe('videoCopies', () => {
  test('hands over the copy with the way to remove it', async () => {
    const copies = videoCopies({ root: () => root, fetch: writes });

    const copy = await copies.fetch(VIDEO, never);

    expect(copy).toMatchObject({ ok: true, path: join(root, 'video-temp', `${VIDEO}.mp4`) });
    if (!copy.ok) throw new Error('expected a copy');
    await copy.remove?.();
    expect(existsSync(copy.path)).toBe(false);
  });

  test('fetches a video whose id begins with a dash like any other', async () => {
    const asked: string[] = [];
    const copies = videoCopies({
      root: () => root,
      fetch: (videoId, stop) => {
        asked.push(videoId);
        return writes(videoId, stop);
      },
    });

    const copy = await copies.fetch(DASHED, never);

    expect(asked).toEqual([DASHED]);
    expect(copy).toMatchObject({ ok: true, path: join(root, 'video-temp', `${DASHED}.mp4`) });
  });

  test.each([
    [
      'YouTube refused',
      {
        ok: false,
        kind: 'refused',
        message: 'YouTube refused this computer’s connection for now. Try again in a few hours.',
        via: 'yt-dlp',
      },
      'YouTube refused this computer’s connection for now. Try again in a few hours',
    ],
    [
      'the video is too large',
      { ok: false, kind: 'too-large', message: 'The video is larger than 95 MB.', via: 'built-in' },
      'The video is larger than 95 MB',
    ],
  ] as const)('gives the plain reason when %s', async (_what, answer, reason) => {
    const copies = videoCopies({ root: () => root, fetch: fails(answer) });

    expect(await copies.fetch(VIDEO, never)).toEqual({ ok: false, reason });
  });

  test('gives a reason, without file paths, when the downloader itself breaks', async () => {
    const copies = videoCopies({
      root: () => root,
      fetch: async () => {
        throw new Error('ENOSPC: no space left, write /home/owner/jgtube/downloads/x.mp4');
      },
    });

    const copy = await copies.fetch(VIDEO, never);

    expect(copy).toMatchObject({ ok: false });
    expect(copy.ok ? '' : copy.reason).toContain('no space left');
    expect(copy.ok ? '' : copy.reason).not.toContain('/home/owner');
  });

  test('says there is nowhere to save when the store is only in memory', async () => {
    const copies = videoCopies({
      root: () => {
        throw new Error('This store is only in memory. Set JGTUBE_DOWNLOADS_PATH.');
      },
      fetch: writes,
    });

    expect(await copies.fetch(VIDEO, never)).toEqual({
      ok: false,
      reason: 'This store is only in memory. Set JGTUBE_DOWNLOADS_PATH',
    });
  });

  test('removes a copy that arrived after Jgtube began closing, and hands over none', async () => {
    const closing = new AbortController();
    const copies = videoCopies({
      root: () => root,
      fetch: async (videoId, stop) => {
        closing.abort();
        return writes(videoId, stop);
      },
    });

    const copy = await copies.fetch(VIDEO, closing.signal);

    expect(copy).toEqual({ ok: false, reason: 'Jgtube is closing' });
    expect(existsSync(join(root, 'video-temp', `${VIDEO}.mp4`))).toBe(false);
  });

  test('removes every copy still on disk when Jgtube closes, and only those', async () => {
    const copies = videoCopies({ root: () => root, fetch: writes });
    const first = await copies.fetch(VIDEO, never);
    const second = await copies.fetch(DASHED, never);
    if (!first.ok || !second.ok) throw new Error('expected two copies');
    await first.remove?.();
    const elsewhere = join(root, 'video-temp', 'not-ours.mp4');
    writeFileSync(elsewhere, 'x');

    copies.removeLeftovers();
    copies.removeLeftovers();

    expect(existsSync(second.path)).toBe(false);
    expect(existsSync(elsewhere)).toBe(true);
  });
});
