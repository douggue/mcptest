import { describe, expect, test } from 'vitest';
import {
  channelRunsLine,
  fetchChannelRuns,
  clock,
  createTeardownApi,
  imageUrl,
  judgedBy,
  kindName,
  markdownUrl,
  metricRows,
  mixRows,
  percent,
  runsLine,
  stageProblem,
  zipUrl,
  type TeardownView,
} from '../src/lib/teardown';

const VIDEO = 'dQw4w9WgXcQ';

const view = {
  videoId: VIDEO,
  measured: {
    video: {
      durationSeconds: 125,
      width: 1920,
      height: 1080,
      fps: 30,
      hasAudio: true,
      method: 'ffprobe',
    },
    shots: {
      cutCount: 10,
      medianSeconds: 6,
      averageSeconds: 7,
      cutsPerMinute: 4.8,
      method: 'scene',
    },
    loudness: { integratedLufs: -16, lraLu: 4, truePeakDbfs: -1, method: 'ebur128' },
    quietDips: { items: [{ start: 1, end: 2 }], method: 'silencedetect' },
    peaks: { items: [], method: 'astats' },
  },
  transcript: {
    source: 'heard',
    words: { wordCount: 300, wordsPerMinute: 144, medianSentenceWords: 9 },
  },
  stages: {
    hook: { state: 'done', engine: 'claude', data: {} },
    plan: { state: 'failed', reason: 'Limit reached.' },
  },
} as unknown as TeardownView;

describe('the teardown on the page', () => {
  test('lists every measured number with its method', () => {
    expect(metricRows(view)).toEqual([
      { label: 'Runtime', value: '2:05 (125 s)', method: 'ffprobe' },
      { label: 'Picture', value: '1920×1080 at 30 fps', method: 'ffprobe' },
      {
        label: 'Shot pacing',
        value: '10 cuts · median shot 6 s · average 7 s · 4.8 cuts/min',
        method: 'scene',
      },
      {
        label: 'Words',
        value: '300 words · 144 words/min · median sentence 9 words',
        method: 'counted in code from the words an engine heard',
      },
      { label: 'Loudness', value: '-16 LUFS · range 4 LU · true peak -1 dBFS', method: 'ebur128' },
      { label: 'Quiet dips', value: '1', method: 'silencedetect' },
      { label: 'Peak impacts', value: '0', method: 'astats' },
    ]);
    const bare = {
      ...view,
      measured: {
        ...view.measured,
        loudness: null,
        quietDips: null,
        peaks: null,
        video: { ...view.measured?.video, width: null, height: null, fps: null },
      },
      transcript: { source: 'captions', words: null },
    } as unknown as TeardownView;
    expect(metricRows(bare).map((row) => row.label)).toEqual(['Runtime', 'Picture', 'Shot pacing']);
    expect(metricRows(bare)[1]?.value).toBe('?×? at ? fps');
    expect(metricRows({ ...view, measured: null } as TeardownView)).toEqual([]);
  });

  test('counts mixes, the most frequent first, and names stages and pictures', () => {
    expect(mixRows({ cut: 3, dissolve: 0, flash: 5 })).toEqual([
      { kind: 'Flash', count: 5 },
      { kind: 'Hard cut', count: 3 },
    ]);
    expect(kindName('mystery')).toBe('mystery');
    expect(stageProblem(view, 'plan')).toBe('Limit reached.');
    expect(stageProblem(view, 'hook')).toBeNull();
    expect(judgedBy(view, 'hook', (engine) => engine.toUpperCase())).toBe(
      "The AI's reading (CLAUDE), checked in code.",
    );
    expect(judgedBy(view, 'plan', String)).toBeNull();
    expect(clock(-3)).toBe('0:00');
    expect(clock(61.9)).toBe('1:01');
    expect(percent(0.1234)).toBe('12.3%');
    expect(imageUrl(VIDEO, 'k-001.jpg')).toBe(`/api/video-teardowns/${VIDEO}/images/k-001.jpg`);
    expect(markdownUrl(VIDEO)).toBe(`/api/video-teardowns/${VIDEO}/teardown.md`);
    expect(zipUrl(VIDEO)).toBe(`/api/video-teardowns/${VIDEO}/export.zip`);
  });

  test('says how many AI runs a teardown takes before it starts', () => {
    expect(runsLine({ runs: 0, kept: 9, watch: true })).toMatch(/no AI run is needed/);
    expect(runsLine({ runs: 9, kept: 0, watch: true })).toBe(
      'This takes up to 9 AI runs, one of them watching it with sound, plus measuring in code.',
    );
    expect(runsLine({ runs: 1, kept: 1, watch: false })).toBe(
      'This takes up to 1 AI run, plus measuring in code. 1 part is kept from the last run.',
    );
    expect(runsLine({ runs: 3, kept: 5, watch: false })).toMatch(/5 parts are kept/);
  });

  test('asks the server for the run count', async () => {
    const asked: string[] = [];
    const api = createTeardownApi(async (url) => {
      asked.push(String(url));
      return new Response(
        JSON.stringify({ success: true, data: { runs: 8, kept: 0, watch: false }, error: null }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      );
    });
    expect(await api.runs(VIDEO, true)).toEqual({ runs: 8, kept: 0, watch: false });
    await api.runs(null, false);
    expect(asked).toEqual([
      `/api/video-teardowns/runs?video=${VIDEO}&fresh=1`,
      '/api/video-teardowns/runs?',
    ]);
  });
});

describe('what a channel breakdown takes', () => {
  test('is said in one line, and asked of the server for the chosen count', async () => {
    expect(
      channelRunsLine({ videos: 3, contrast: 2, measuredInCode: 5, aiRuns: 13, watch: true }),
    ).toBe(
      '3 top videos studied in depth and 2 ordinary ones for contrast, 5 measured in code (no AI). Up to 13 AI runs: one frame study, one watch with sound per video, and the 7 parts.',
    );
    expect(
      channelRunsLine({ videos: 1, contrast: 2, measuredInCode: 3, aiRuns: 8, watch: false }),
    ).toMatch(/^1 top video studied/);
    const asked: string[] = [];
    const runs = await fetchChannelRuns(4, async (url) => {
      asked.push(String(url));
      return new Response(JSON.stringify({ success: true, data: { videos: 4 }, error: null }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    expect(runs).toEqual({ videos: 4 });
    expect(asked).toEqual(['/api/breakdowns/runs?videos=4']);
  });
});
