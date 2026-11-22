import {
  SqliteVideoBreakdownRepo,
  SqliteVideoStudyRepo,
  markerLines,
  openDatabase,
  type StudiedFrames,
} from '@jgtube/core';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { BreakdownFiles } from '../src/breakdownEngine';
import { EngineRunError } from '../src/engines/failure';
import { breakDownVideo, type OneVideoDeps } from '../src/oneVideoEngine';
import type { OneVideoFocus } from '../src/oneVideoQuestions';
import type { OneVideoProgress } from '../src/oneVideoTypes';
import { CLOSING } from '../src/running';

const NOW = new Date('2026-11-21T12:00:00Z');
const VIDEO = 'dQw4w9WgXcQ';
const UPLOAD = 'Ab-_cdEFgh1';
const CHANNEL = `UC${'a'.repeat(22)}`;
const ANSWER = [
  'WHAT IT IS',
  '- A ten-minute explainer [0:00].',
  markerLines('SCRIPT PROMPT').start,
  'Write about [TOPIC].',
  markerLines('SCRIPT PROMPT').end,
].join('\n');

let studies: SqliteVideoStudyRepo;
let store: SqliteVideoBreakdownRepo;
let removed: string[];

interface Setup {
  readonly own?: string | null;
  readonly fetch?: 'ok' | 'fails';
  readonly canCut?: boolean;
  readonly cut?: boolean;
  readonly preview?: StudiedFrames | null;
  readonly watch?: 'ok' | 'fails';
  readonly frames?: 'ok' | 'fails';
  readonly captions?: 'read' | 'none' | 'throws';
  readonly write?: 'ok' | 'fails';
  readonly upload?: string | null;
  readonly details?: 'ok' | 'throws';
  readonly stop?: AbortSignal;
}

function deps(setup: Setup = {}) {
  const files: BreakdownFiles = {
    ownFolder: () => '/downloads/my-videos',
    own: async () => setup.own ?? null,
    fetch: async () =>
      setup.fetch === 'fails'
        ? { ok: false, reason: 'YouTube refused the download' }
        : { ok: true, path: '/temp/copy.mp4', remove: async () => void removed.push('copy') },
    canCut: async () => setup.canCut ?? false,
    cut: async () =>
      setup.cut === false
        ? { ok: false, reason: 'ffmpeg failed' }
        : { ok: true, folder: '/temp/frames', sheets: 3, frames: 75 },
    removeFrames: async () => void removed.push('frames'),
    forWatching: async (_id, path) => ({ ok: true, path }),
  } as BreakdownFiles;
  const watchVideo = vi.fn<OneVideoDeps['watchVideo']>(async (_id, _q, options) => {
    options?.onStep?.({ kind: 'watching', engine: 'agy' });
    if (setup.watch === 'fails') throw new EngineRunError('not-installed', 'Nobody can watch.');
    const copy = await options?.download?.(VIDEO, new AbortController().signal);
    return {
      engine: 'agy',
      text: `watched ${copy?.ok === true ? copy.path : 'nothing'}`,
      skipped: [],
      turns: null,
    };
  });
  const write = vi.fn<OneVideoDeps['write']>(async () => {
    if (setup.write === 'fails')
      throw new EngineRunError('limit', 'Claude Code reached its limit.');
    return { engine: 'claude', text: ANSWER, skipped: [], turns: null };
  });
  const value: OneVideoDeps = {
    now: () => NOW,
    stop: setup.stop ?? new AbortController().signal,
    studies,
    store,
    files,
    uploadPath: async () =>
      setup.upload === undefined ? '/downloads/my-videos/x.webm' : setup.upload,
    details: async () => {
      if (setup.details === 'throws') throw new Error('offline');
      return { title: 'How maps lie', channelId: CHANNEL, durationSeconds: 600 };
    },
    readTranscript: async () => {
      if (setup.captions === 'throws') throw new Error('offline');
      return {
        videoId: VIDEO,
        transcript: setup.captions === 'none' ? null : ({ segments: [] } as never),
        fetchedAt: NOW,
        fromStore: false,
      };
    },
    framesAvailable: async () =>
      setup.preview === undefined ? { source: 'preview', available: 40 } : setup.preview,
    watchVideo,
    studyFrames: async () => {
      if (setup.frames === 'fails') throw new EngineRunError('failed', 'The frame study failed.');
      return { engine: 'claude', text: 'Frames: a map.', skipped: [], turns: null };
    },
    write,
  };
  return { value, watchVideo, write };
}

const progress: OneVideoProgress[] = [];
const report = (step: OneVideoProgress): void => void progress.push(step);

beforeEach(() => {
  const db = openDatabase(':memory:');
  studies = new SqliteVideoStudyRepo(db);
  store = new SqliteVideoBreakdownRepo(db);
  removed = [];
  progress.length = 0;
});

describe('a deep breakdown of one YouTube video', () => {
  test('downloads it, has it watched and its frames studied, writes it, and keeps how it was seen', async () => {
    const { value, write } = deps({ canCut: true });

    const view = await breakDownVideo(value, { kind: 'youtube', videoId: VIDEO }, report);

    expect(view).toMatchObject({
      videoId: VIDEO,
      source: 'youtube',
      title: 'How maps lie',
      channelId: CHANNEL,
      engine: 'claude',
      problem: null,
      prompts: { script: 'Write about [TOPIC].', visual: null, thumbnail: null },
      seen: {
        file: 'downloaded',
        watchedBy: 'agy',
        framesBy: 'claude',
        frameSource: 'preview',
        captions: 'read',
        notes: [],
      },
    });
    expect(view.body).toContain('WHAT IT IS');
    expect(view.body).not.toContain('SCRIPT PROMPT');
    const focus: OneVideoFocus = {
      kind: 'one-video',
      videoId: VIDEO,
      watched: true,
      frames: true,
      captions: true,
    };
    expect(write).toHaveBeenCalledWith('one-video', focus, undefined);
    expect(studies.find(VIDEO, 'watch')?.text).toBe('watched /temp/copy.mp4');
    expect(removed).toEqual(['frames', 'copy']);
    expect(progress.map((step) => step.step)).toEqual([
      'reading',
      'downloading',
      'watching',
      'frames',
      'frames',
      'writing',
    ]);
  });

  test('with nothing to watch it, says so, and still writes from frames and captions', async () => {
    const { value } = deps({ fetch: 'fails', watch: 'fails', details: 'throws' });

    const view = await breakDownVideo(value, { kind: 'youtube', videoId: VIDEO }, report);

    expect(view.title).toBe(`YouTube video ${VIDEO}`);
    expect(view.seen).toMatchObject({
      file: 'none',
      fileNote: 'YouTube refused the download.',
      watchedBy: null,
      framesBy: 'claude',
    });
    expect(view.seen.notes).toEqual(['Not watched, so its sound is not known: Nobody can watch.']);
  });

  test('reuses a watch and a frame study already kept, unless asked to start afresh', async () => {
    studies.save({ videoId: VIDEO, kind: 'watch', engine: 'gemini-api', text: 'old watch' }, NOW);
    studies.save(
      {
        videoId: VIDEO,
        kind: 'frames',
        engine: 'codex',
        text: 'old frames',
        frames: { source: 'file', available: 9 },
      },
      NOW,
    );
    const kept = deps({ own: '/downloads/my-videos/mine.mp4' });

    const view = await breakDownVideo(kept.value, { kind: 'youtube', videoId: VIDEO }, report);

    expect(view.seen).toMatchObject({
      file: 'own',
      watchedBy: 'gemini-api',
      framesBy: 'codex',
      frames: 9,
    });
    expect(kept.watchVideo).not.toHaveBeenCalled();

    const fresh = deps({ own: '/downloads/my-videos/mine.mp4' });
    await breakDownVideo(fresh.value, { kind: 'youtube', videoId: VIDEO }, report, {
      fresh: true,
      only: 'codex',
    });
    expect(fresh.watchVideo).toHaveBeenCalled();
    expect(fresh.write.mock.calls[0]?.[2]).toBe('codex');
  });

  test('does not download a video too long to watch, and notes a frame study that failed', async () => {
    const { value } = deps({ frames: 'fails', captions: 'none' });
    const long = {
      ...value,
      details: async () => ({ title: 'Long', channelId: null, durationSeconds: 7200 }),
    };

    const view = await breakDownVideo(long, { kind: 'youtube', videoId: VIDEO }, report);

    expect(view.seen.fileNote).toMatch(/long/);
    expect(view.seen.framesBy).toBeNull();
    expect(view.seen.captions).toBe('none');
    expect(view.seen.notes).toContain('Frames not studied: The frame study failed.');
  });

  test('refuses to write from nothing, and keeps why writing failed', async () => {
    const nothing = deps({ fetch: 'fails', watch: 'fails', preview: null, captions: 'throws' });
    await expect(
      breakDownVideo(nothing.value, { kind: 'youtube', videoId: VIDEO }, report),
    ).rejects.toThrow(/nothing to break it down from/);
    expect(nothing.write).not.toHaveBeenCalled();

    const failing = deps({ write: 'fails' });
    await expect(
      breakDownVideo(failing.value, { kind: 'youtube', videoId: VIDEO }, report),
    ).rejects.toThrow(/limit/);
    expect(store.find(VIDEO)).toMatchObject({
      written: null,
      problem: 'Claude Code reached its limit.',
    });
  });

  test('stops when Jgtube is closing', async () => {
    const stop = new AbortController();
    stop.abort();
    const { value } = deps({ stop: stop.signal, fetch: 'fails' });

    await expect(
      breakDownVideo(value, { kind: 'youtube', videoId: VIDEO }, report),
    ).rejects.toThrow(CLOSING);
  });
});

describe('a deep breakdown of a file the owner gave', () => {
  test('watches the file alone, cuts its frames, asks no captions and writes the file form', async () => {
    const { value, watchVideo, write } = deps({ canCut: true });

    const view = await breakDownVideo(
      value,
      { kind: 'file', videoId: UPLOAD, name: 'clip.webm' },
      report,
    );

    expect(view).toMatchObject({ source: 'file', title: 'clip.webm', channelId: null });
    expect(view.seen).toMatchObject({
      file: 'uploaded',
      captions: 'not-asked',
      frameSource: 'preview',
    });
    expect(watchVideo.mock.calls[0]?.[2]?.fileOnly).toBe(true);
    expect(write.mock.calls[0]?.[0]).toBe('one-video-file');
    // The owner's file is only read, never removed.
    expect(removed).toEqual(['frames']);
  });

  test('has no preview frames to fall back on when frames cannot be cut', async () => {
    const { value } = deps({ canCut: true, cut: false });

    const view = await breakDownVideo(
      value,
      { kind: 'file', videoId: UPLOAD, name: 'clip.mov' },
      report,
    );

    expect(view.seen.framesBy).toBeNull();
    expect(view.seen.notes).toContain(
      'There were no frames to study: no file to cut them from and no preview frames.',
    );
  });

  test('fails plainly when the file is gone', async () => {
    const { value } = deps({ upload: null });

    await expect(
      breakDownVideo(value, { kind: 'file', videoId: UPLOAD, name: 'clip.mp4' }, report),
    ).rejects.toThrow(/no longer on this computer/);
  });
});
