import { describe, expect, test } from 'vitest';
import { uploadBreakdownFile, type UploadRequest } from '../src/lib/upload';
import {
  MAX_FILE_BYTES,
  createBreakdownViewApi,
  fileProblem,
  fileType,
  linkProblem,
  routeLine,
  seenLines,
  videoIdFrom,
  type VideoBreakdownView,
  type VideoSeen,
} from '../src/lib/videoBreakdown';

const VIDEO = 'dQw4w9WgXcQ';

const SEEN: VideoSeen = {
  file: 'downloaded',
  fileNote: null,
  watchedBy: 'agy',
  framesBy: 'claude',
  frameSource: 'file',
  frames: 300,
  captions: 'read',
  notes: [],
};

const view: VideoBreakdownView = {
  videoId: VIDEO,
  source: 'youtube',
  title: 'How maps lie',
  channelId: null,
  writtenAt: '2026-11-21T12:00:00.000Z',
  seen: SEEN,
  engine: 'jgtube',
  problem: null,
  teardown: null,
};

describe('a YouTube link typed on the One video tab', () => {
  test.each([
    [VIDEO, VIDEO],
    [`https://www.youtube.com/watch?v=${VIDEO}&t=30`, VIDEO],
    [`youtu.be/${VIDEO}`, VIDEO],
    [`https://m.youtube.com/shorts/${VIDEO}`, VIDEO],
    [`https://www.youtube.com/embed/${VIDEO}`, VIDEO],
    ['https://example.com/watch?v=dQw4w9WgXcQ', null],
    ['https://www.youtube.com/@channel', null],
    ['not a link at all', null],
    ['http://[bad', null],
  ])('%s names the video %s', (typed, id) => {
    expect(videoIdFrom(typed)).toBe(id);
  });

  test('is checked with a plain reason', () => {
    expect(linkProblem('  ')).toMatch(/Paste a YouTube video link/);
    expect(linkProblem('https://www.youtube.com/@x')).toMatch(/not a YouTube video link/);
    expect(linkProblem(VIDEO)).toBeNull();
  });
});

describe('a video file chosen on the One video tab', () => {
  test('is taken as MP4, WebM or MOV, by its type or else by its name', () => {
    expect(fileType({ name: 'a.bin', type: 'video/webm' })).toBe('video/webm');
    expect(fileType({ name: 'clip.MOV', type: '' })).toBe('video/quicktime');
    expect(fileType({ name: 'clip.avi', type: 'video/x-msvideo' })).toBeNull();
    expect(fileType({ name: 'clip', type: '' })).toBeNull();
  });

  test('is refused with a plain reason when of another kind, empty or too large', () => {
    expect(fileProblem({ name: 'a.avi', type: '', size: 5 })).toMatch(/MP4, WebM or MOV/);
    expect(fileProblem({ name: 'a.mp4', type: 'video/mp4', size: 0 })).toMatch(/empty/);
    expect(fileProblem({ name: 'a.mp4', type: 'video/mp4', size: MAX_FILE_BYTES + 1 })).toMatch(
      /more than the 2\.0 GB/,
    );
    expect(fileProblem({ name: 'a.mp4', type: 'video/mp4', size: 10 })).toBeNull();
  });
});

describe('how the video was seen', () => {
  test('says the route used and what the teardown rests on', () => {
    expect(routeLine(SEEN)).toBe(
      'Watched, picture and sound, by Antigravity from a copy on this computer; 300 frames measured in code.',
    );
    expect(routeLine({ ...SEEN, file: 'uploaded', frames: null })).toBe(
      'Watched, picture and sound, by Antigravity from the file you gave.',
    );
    expect(seenLines(SEEN)).toEqual({
      could: [
        'Every frame, measured in code: cuts, colours, transitions, motion.',
        'Its loudness, measured in code.',
        'The sound itself: voice, music and sound effects.',
        'What is said, from its captions.',
      ],
      couldNot: [],
    });
  });

  test('says plainly when nothing heard it, and what else was missing', () => {
    const measuredOnly: VideoSeen = {
      ...SEEN,
      fileNote: null,
      watchedBy: null,
      captions: 'none',
      notes: ['A note.'],
    };
    expect(routeLine(measuredOnly)).toBe(
      'Not watched with sound: 300 frames measured in code; its pictures studied by Claude Code.',
    );
    expect(routeLine({ ...measuredOnly, framesBy: null })).toBe(
      'Not watched with sound: 300 frames measured in code.',
    );
    expect(seenLines(measuredOnly).couldNot).toEqual([
      'The sound itself: nothing heard it, so sound rests on the measured loudness.',
      'Captions: YouTube has none for it.',
      'A note.',
    ]);
    const nothing: VideoSeen = {
      ...measuredOnly,
      file: 'none',
      fileNote: 'YouTube refused the download.',
      frames: null,
      captions: 'failed',
      notes: [],
    };
    expect(routeLine(nothing)).toMatch(/captions alone/);
    expect(seenLines(nothing).couldNot).toEqual([
      'The sound itself: nothing heard it, so sound rests on the measured loudness.',
      'The pictures: there was no file to measure.',
      'Captions: they could not be read this time.',
      'File: YouTube refused the download.',
    ]);
  });
});

describe('the Breakdown view’s requests', () => {
  test('ask for candidates, read a channel, start, list and find a breakdown, and follow its job', async () => {
    const asked: Array<[string, string | undefined]> = [];
    const replies: unknown[] = [
      { candidates: [{ id: 'x' }] },
      { candidate: { id: 'y' } },
      { jobId: 'j1', video: VIDEO },
      { jobId: 'j2', video: 'Ab-_cdEFgh1' },
      { items: [] },
      view,
      { status: 'running', progress: null, result: null, error: null },
    ];
    const api = createBreakdownViewApi(async (path, init) => {
      asked.push([String(path), typeof init?.body === 'string' ? init.body : undefined]);
      return new Response(JSON.stringify({ success: true, data: replies.shift(), error: null }));
    });

    expect(await api.candidates([])).toEqual([]);
    expect(await api.candidates(['x'])).toEqual([{ id: 'x' }]);
    expect(await api.readChannel('@y')).toEqual({ id: 'y' });
    expect(await api.startVideo({ video: VIDEO }, 'auto', false)).toEqual({
      jobId: 'j1',
      video: VIDEO,
    });
    await api.startVideo({ file: 'Ab-_cdEFgh1', name: 'clip.mov' }, 'claude', true);
    expect(await api.videoBreakdowns()).toEqual([]);
    expect(await api.videoBreakdown(VIDEO)).toEqual(view);
    expect((await api.job('j 2')).status).toBe('running');
    expect(asked).toEqual([
      ['/api/breakdowns/candidates', '{"ids":["x"]}'],
      ['/api/breakdowns/channel', '{"channel":"@y"}'],
      ['/api/video-breakdowns', `{"video":"${VIDEO}","fresh":false}`],
      [
        '/api/video-breakdowns',
        '{"file":"Ab-_cdEFgh1","name":"clip.mov","engine":"claude","fresh":true}',
      ],
      ['/api/video-breakdowns', undefined],
      [`/api/video-breakdowns?video=${VIDEO}`, undefined],
      ['/api/jobs/j%202', undefined],
    ]);
  });
});

describe('uploadBreakdownFile', () => {
  test('sends the file with its type to the files address and gives back where it was saved', async () => {
    const calls: unknown[][] = [];
    const request: UploadRequest = {
      status: 201,
      responseText: JSON.stringify({
        success: true,
        data: { file: 'Ab-_cdEFgh1', bytes: 5, kind: 'webm' },
      }),
      upload: { onprogress: null },
      onload: null,
      onerror: null,
      onabort: null,
      open: (...args) => void calls.push(['open', ...args]),
      setRequestHeader: (...args) => void calls.push(['header', ...args]),
      send: () => void calls.push(['send']),
    };
    const file = new Blob(['x']);

    const sending = uploadBreakdownFile(
      file,
      'video/webm',
      () => undefined,
      () => request,
    );
    request.onload?.();

    expect(await sending).toEqual({ file: 'Ab-_cdEFgh1', bytes: 5, kind: 'webm' });
    expect(calls).toEqual([
      ['open', 'PUT', '/api/video-breakdowns/files'],
      ['header', 'content-type', 'video/webm'],
      ['send'],
    ]);
  });
});
