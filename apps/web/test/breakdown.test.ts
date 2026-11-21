import { describe, expect, test } from 'vitest';
import { ApiError, createApi } from '../src/lib/api';
import {
  SLOW_NOTE,
  breakdownChoices,
  groupChoices,
  describeTranscripts,
  folderNote,
  formatBytes,
  restsOn,
  savedText,
  sendingText,
  studiedLines,
  type BreakdownOutcome,
  type MapChannels,
  type StudiedVideo,
} from '../src/lib/breakdown';
import { uploadVideoFile, type UploadRequest } from '../src/lib/upload';

const cid = (n: number) => `UC${String(n).padStart(22, '0')}`;
const VIDEO = 'dQw4w9WgXcQ';

const map: MapChannels = {
  center: { id: cid(1), title: 'My Channel' },
  model: { id: cid(2), title: 'The Model' },
  channels: [
    { id: cid(5), title: 'Zebra Films', peer: true, removed: false },
    { id: cid(2), title: 'The Model', peer: true, removed: false },
    { id: cid(3), title: 'alpha history', peer: true, removed: false },
    { id: cid(4), title: 'Not Alike', peer: false, removed: false },
    { id: cid(6), title: 'Removed One', peer: true, removed: true },
  ],
};

const studied = (overrides: Partial<StudiedVideo> = {}): StudiedVideo => ({
  videoId: VIDEO,
  title: 'How it was built',
  file: { used: 'downloaded' },
  watch: { done: true, by: 'agy', kept: false },
  frames: { done: true, by: 'claude', kept: false, source: 'file', available: 948 },
  ...overrides,
});

const outcome = (overrides: Partial<BreakdownOutcome> = {}): BreakdownOutcome => ({
  channel: { id: cid(3), title: 'alpha history' },
  storedVideos: 40,
  top: [1, 2, 3, 4, 5].map((n) => ({
    videoId: `video00000${n}`,
    title: `V${n}`,
    captions: 'read',
  })),
  deep: [studied()],
  supply: [],
  ownVideosFolder: 'C:\\jgtube\\downloads\\my-videos',
  text: 'CHANNEL IDENTITY',
  engine: 'claude',
  skipped: [],
  ...overrides,
});

describe('breakdownChoices', () => {
  test('lists the model, the owner’s channel, then the look-alikes by name, each once', () => {
    expect(breakdownChoices(map)).toEqual([
      { id: cid(2), title: 'The Model', label: 'Your model: The Model', group: 'map' },
      { id: cid(1), title: 'My Channel', label: 'Your channel: My Channel', group: 'map' },
      { id: cid(3), title: 'alpha history', label: 'alpha history', group: 'map' },
      { id: cid(5), title: 'Zebra Films', label: 'Zebra Films', group: 'map' },
    ]);
  });

  test('starts with the owner’s channel when no model was named', () => {
    const choices = breakdownChoices({ ...map, model: null });

    expect(choices[0]).toMatchObject({ id: cid(1), label: 'Your channel: My Channel' });
    expect(choices.map((choice) => choice.id)).toEqual([cid(1), cid(3), cid(2), cid(5)]);
  });

  test('adds the owner’s other saved channels and the niche lists, each channel once', () => {
    const choices = breakdownChoices(map, {
      saved: [
        { id: cid(1), title: 'My Channel' },
        { id: cid(7), title: 'Sea Monsters' },
      ],
      niches: [
        { id: cid(8), title: 'Tiny Riser', watched: false },
        { id: cid(9), title: 'Watched One', watched: true },
        { id: cid(3), title: 'alpha history', watched: true },
        { id: cid(7), title: 'Sea Monsters', watched: false },
      ],
    });

    expect(choices.slice(4)).toEqual([
      { id: cid(7), title: 'Sea Monsters', label: 'Sea Monsters', group: 'saved' },
      { id: cid(9), title: 'Watched One', label: 'Watched One', group: 'watched' },
      { id: cid(8), title: 'Tiny Riser', label: 'Tiny Riser', group: 'niches' },
    ]);
    expect(groupChoices(choices).map((group) => [group.label, group.choices.length])).toEqual([
      ['This map', 4],
      ['Your other channels', 1],
      ['Niches you are watching', 1],
      ['New niches', 1],
    ]);
    expect(groupChoices(breakdownChoices(map)).map((group) => group.label)).toEqual(['This map']);
  });

  test('offers the owner’s channel alone on a map with no look-alikes', () => {
    expect(breakdownChoices({ center: map.center, model: null, channels: [] })).toHaveLength(1);
  });
});

describe('restsOn', () => {
  test('says how many videos the breakdown rests on, out of how many stored', () => {
    expect(restsOn(outcome())).toBe(
      'Rests on the channel’s top 5 videos out of 40 stored, 1 of them studied in depth.',
    );
  });

  test('says so when the channel had fewer, and when some have no captions', () => {
    const few = outcome({
      storedVideos: 2,
      top: [
        { videoId: 'a', title: 'A', captions: 'none' },
        { videoId: 'b', title: 'B', captions: 'failed' },
      ],
      deep: [],
    });

    expect(restsOn(few)).toBe(
      'Rests on the channel’s top 2 videos out of 2 stored, 0 of them studied in depth. 1 of the 2 has no captions. The captions of 1 could not be read this time.',
    );
    expect(restsOn(outcome({ top: [{ videoId: 'a', title: 'A', captions: 'read' }] }))).toContain(
      'top 1 video out of',
    );
  });

  test('says there are no videos for a channel with none stored', () => {
    expect(restsOn(outcome({ top: [], deep: [], storedVideos: 0 }))).toBe(
      'Jgtube has no videos stored for this channel.',
    );
  });
});

describe('studiedLines', () => {
  test('says who watched each video and where its frames came from', () => {
    expect(studiedLines(outcome())).toEqual([
      '“How it was built”. Watched by Antigravity. Frames studied by Claude Code: 948 frames cut from the video file, one a second.',
    ]);
  });

  test('gives the plain reason a video was not watched, and says preview frames are small', () => {
    const lines = studiedLines(
      outcome({
        deep: [
          studied({
            watch: { done: false, reason: 'No engine on this computer can watch a video.' },
            frames: { done: true, by: 'codex', kept: true, source: 'preview', available: 181 },
          }),
        ],
      }),
    );

    expect(lines).toEqual([
      '“How it was built”. Not watched: No engine on this computer can watch a video. Frames studied by Codex: 181 frames from YouTube’s own preview (small, several seconds apart), kept from an earlier breakdown.',
    ]);
  });

  test('says when the frames could not be studied, and copes with an older study', () => {
    const lines = studiedLines(
      outcome({
        deep: [
          studied({
            watch: { done: true, by: 'gemini-api', kept: true },
            frames: { done: false, reason: 'Claude took too long.' },
          }),
          studied({
            frames: { done: true, by: 'someone', kept: false, source: null, available: null },
          }),
        ],
      }),
    );

    expect(lines[0]).toBe(
      '“How it was built”. Watched by the Gemini API, kept from an earlier breakdown. Frames not studied: Claude took too long.',
    );
    expect(lines[1]).toContain('Frames studied by someone: its frames.');
  });

  test('has nothing to say when no video was studied in depth', () => {
    expect(studiedLines(outcome({ deep: [] }))).toEqual([]);
  });
});

describe('what the page says about files', () => {
  test('warns up front that a breakdown is slow', () => {
    expect(SLOW_NOTE).toMatch(/slow/i);
    expect(SLOW_NOTE).toMatch(/half an hour/);
  });

  test('says where the owner’s own files go, or nothing when there is nowhere', () => {
    expect(folderNote('C:\\jgtube\\downloads\\my-videos')).toBe(
      'Or copy the file yourself into C:\\jgtube\\downloads\\my-videos, with the video’s id (the letters after “v=” in its link) somewhere in the file’s name.',
    );
    expect(folderNote(null)).toBe('');
  });

  test('writes a file’s size the way a person reads it', () => {
    expect(formatBytes(1_300_000_000)).toBe('1.3 GB');
    expect(formatBytes(12_400_000)).toBe('12.4 MB');
    expect(formatBytes(850_000)).toBe('850 KB');
    expect(formatBytes(12)).toBe('1 KB');
  });

  test('says how far a file has got, and when it is being checked', () => {
    expect(sendingText(0)).toBe('Sending the file: 0%');
    expect(sendingText(0.424)).toBe('Sending the file: 42%');
    expect(sendingText(1)).toBe('Sent. Checking the file…');
    expect(sendingText(7)).toBe('Sent. Checking the file…');
  });

  test('confirms a saved file with its size and what to do next', () => {
    expect(
      savedText({ video: VIDEO, bytes: 12_400_000, file: `${VIDEO}.mp4`, folder: '/d/my-videos' }),
    ).toBe(
      'Saved (12.4 MB). Jgtube keeps it until you delete it. Run the breakdown again to use it.',
    );
  });
});

describe('describeTranscripts', () => {
  const saved = { channel: cid(3), folder: '/d/transcripts/UC3', indexFile: '/d/x/index.json' };

  test('says where the transcripts are', () => {
    expect(describeTranscripts({ ...saved, saved: 4, noCaptions: 0, failed: 0 })).toBe(
      '4 transcripts saved in /d/transcripts/UC3, with an index.json saying what each one is.',
    );
  });

  test('names the videos with no captions and those that could not be read', () => {
    expect(describeTranscripts({ ...saved, saved: 1, noCaptions: 1, failed: 2 })).toBe(
      '1 transcript saved in /d/transcripts/UC3, with an index.json saying what each one is. 1 video has no captions. 2 could not be read; press again to try once more.',
    );
    expect(describeTranscripts({ ...saved, saved: 0, noCaptions: 2, failed: 0 })).toBe(
      'No transcript could be saved. 2 videos have no captions.',
    );
  });

  test('says there is nothing to save for a channel where nothing has taken off', () => {
    expect(describeTranscripts({ ...saved, saved: 0, noCaptions: 0, failed: 0 })).toMatch(
      /no transcripts to save/,
    );
  });
});

describe('the breakdown calls to the server', () => {
  const reply = (data: unknown, status = 200) =>
    new Response(JSON.stringify({ success: status < 400, data, error: 'No', meta: null }), {
      status,
    });

  test('starts a breakdown for a channel and returns the job to poll', async () => {
    const sent: Array<[string, unknown]> = [];
    const api = createApi(async (path, init) => {
      sent.push([path, JSON.parse(String(init?.body))]);
      return reply({ jobId: 'job-1' }, 202);
    });

    expect(await api.startBreakdown(cid(3))).toBe('job-1');
    await api.startBreakdown(cid(3), 'codex', true);

    expect(sent).toEqual([
      ['/api/breakdowns', { channel: cid(3) }],
      ['/api/breakdowns', { channel: cid(3), engine: 'codex', fresh: true }],
    ]);
  });

  test('gives the server’s reason when a breakdown cannot start', async () => {
    const api = createApi(async () => reply(null, 409));

    await expect(api.startBreakdown(cid(3))).rejects.toEqual(new ApiError('No', 409));
  });

  test('reads a breakdown job and saves a channel’s transcripts', async () => {
    const asked: string[] = [];
    const api = createApi(async (path) => {
      asked.push(path);
      return reply(path.includes('jobs') ? { id: 'j', status: 'running' } : { saved: 2 });
    });

    expect(await api.breakdownJob('j 1')).toMatchObject({ status: 'running' });
    expect(await api.downloadTranscripts(cid(3))).toMatchObject({ saved: 2 });
    expect(asked).toEqual(['/api/jobs/j%201', '/api/transcripts/download']);
  });
});

describe('uploadVideoFile', () => {
  /** A stand-in for the browser's request, which the test finishes by hand. */
  function fakeRequest(status = 201, body: unknown = { success: true, data: { bytes: 5 } }) {
    const calls: unknown[][] = [];
    const request: UploadRequest & { finish(): void; fail(how: 'error' | 'abort'): void } = {
      status,
      responseText: typeof body === 'string' ? body : JSON.stringify(body),
      upload: { onprogress: null },
      onload: null,
      onerror: null,
      onabort: null,
      open: (...args) => void calls.push(['open', ...args]),
      setRequestHeader: (...args) => void calls.push(['header', ...args]),
      send: (file) => void calls.push(['send', file]),
      finish: () => request.onload?.(),
      fail: (how) => (how === 'error' ? request.onerror?.() : request.onabort?.()),
    };
    return { request, calls };
  }
  const file = new Blob(['video']);

  test('sends the file to the video’s own address as an MP4, and reports how far it has got', async () => {
    const { request, calls } = fakeRequest();
    const progress: number[] = [];

    const sending = uploadVideoFile(
      VIDEO,
      file,
      (fraction) => progress.push(fraction),
      () => request,
    );
    request.upload.onprogress?.({ loaded: 25, total: 100 });
    request.upload.onprogress?.({ loaded: 0, total: 0 });
    request.upload.onprogress?.({ loaded: 100, total: 100 });
    request.finish();

    expect(await sending).toEqual({ bytes: 5 });
    expect(progress).toEqual([0.25, 1]);
    expect(calls).toEqual([
      ['open', 'PUT', `/api/breakdowns/videos/${VIDEO}`],
      ['header', 'content-type', 'video/mp4'],
      ['send', file],
    ]);
  });

  test('gives the server’s plain reason when the file is refused', async () => {
    const { request } = fakeRequest(400, {
      success: false,
      data: null,
      error: 'That file is not a complete MP4 video.',
    });

    const sending = uploadVideoFile(
      VIDEO,
      file,
      () => {},
      () => request,
    );
    request.finish();

    await expect(sending).rejects.toEqual(
      new ApiError('That file is not a complete MP4 video.', 400),
    );
  });

  test.each([
    ['a reply that is not what the server sends', 'not json at all', /unexpected reply/],
    ['a refusal with no reason', { success: false }, /could not be saved/],
  ])('copes with %s', async (_what, body, message) => {
    const { request } = fakeRequest(500, body);

    const sending = uploadVideoFile(
      VIDEO,
      file,
      () => {},
      () => request,
    );
    request.finish();

    await expect(sending).rejects.toThrow(message);
  });

  test.each(['error', 'abort'] as const)('says the file could not be sent on %s', async (how) => {
    const { request } = fakeRequest();

    const sending = uploadVideoFile(
      VIDEO,
      file,
      () => {},
      () => request,
    );
    request.fail(how);

    await expect(sending).rejects.toThrow(/could not be sent/);
  });

  test('refuses anything that is not a video id before a request is made', async () => {
    let made = 0;

    await expect(
      uploadVideoFile(
        '../../etc',
        file,
        () => {},
        () => {
          made += 1;
          return fakeRequest().request;
        },
      ),
    ).rejects.toThrow(/video id/);
    expect(made).toBe(0);
  });
});
