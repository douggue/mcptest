import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { downloadVideo } from '../src/downloads/video';
import { MAX_VIDEO_BYTES } from '../src/downloads/videoFile';
import { ytDlpArguments, ytDlpFetcher } from '../src/downloads/ytDlp';

const VIDEO = 'wE5ETbiq1qQ';
const PROXY = 'socks5://owner:hunter2@gate.example.net:7000';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'jgtube-ytdlp-proxy-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** A yt-dlp on a PATH of its own, so `downloadVideo` finds it. */
function installedYtDlp(): string {
  const bin = mkdtempSync(join(root, 'bin-'));
  writeFileSync(join(bin, 'yt-dlp'), '');
  chmodSync(join(bin, 'yt-dlp'), 0o755);
  return bin;
}

describe('yt-dlp and the proxy for YouTube', () => {
  test('is told the proxy as one argument when one is given', () => {
    const args = ytDlpArguments(VIDEO, '/data/video-temp', 1, null, null, PROXY);
    expect(args[args.indexOf('--proxy') + 1]).toBe(PROXY);
    expect(args.indexOf('--proxy')).toBeLessThan(args.indexOf('--'));
  });

  test('is told no proxy when none is given', () => {
    expect(ytDlpArguments(VIDEO, '/data/video-temp', 1)).not.toContain('--proxy');
  });

  test('downloadVideo hands yt-dlp the proxy saved in the settings', async () => {
    const bin = installedYtDlp();
    const started: Array<readonly string[]> = [];
    await downloadVideo(VIDEO, {
      root,
      env: { PATH: bin, JGTUBE_YOUTUBE_PROXY: PROXY },
      platform: 'linux',
      run: async (_program, args) => {
        started.push(args);
        writeFileSync(join(args[args.indexOf('--paths') + 1] ?? '', `${VIDEO}.mp4`), 'video');
        return { code: 0, stdout: '948|360|mp4|18', stderr: '' };
      },
    });
    expect(started).toHaveLength(1);
    expect(started[0]?.[started[0].indexOf('--proxy') + 1]).toBe(PROXY);
  });

  test('downloadVideo starts yt-dlp without a proxy when none is saved', async () => {
    const bin = installedYtDlp();
    const started: Array<readonly string[]> = [];
    await downloadVideo(VIDEO, {
      root,
      env: { PATH: bin },
      platform: 'linux',
      run: async (_program, args) => {
        started.push(args);
        return { code: 1, stdout: '', stderr: 'ERROR: nothing' };
      },
    });
    expect(started[0]).not.toContain('--proxy');
  });

  test('never repeats the proxy’s password in what it says went wrong', async () => {
    const folder = join(root, 'video-temp');
    const fetcher = ytDlpFetcher(
      '/usr/local/bin/yt-dlp',
      async () => ({
        code: 1,
        stdout: '',
        stderr: `ERROR: Unable to connect to proxy ${PROXY}: authentication for owner:hunter2 failed`,
      }),
      { proxy: PROXY, nodePath: null },
    );
    const result = await fetcher.fetch(VIDEO, folder, MAX_VIDEO_BYTES);
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain('hunter2');
  });
});
