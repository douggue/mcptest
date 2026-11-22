import { describe, expect, test } from 'vitest';
import { planKeyframes } from '../src/teardown/keyframes';
import { dominantColours, hexOf } from '../src/teardown/palette';
import {
  frameRate,
  parseEbur128,
  parsePeakWindows,
  parseProbe,
  parseSceneCuts,
  parseSilences,
  peakImpacts,
} from '../src/teardown/parse';
import { median, shotSpans, shotStats } from '../src/teardown/shots';
import { quoteFound, sentencesOf, wordStats } from '../src/teardown/words';
import { parseMeasurements } from '../src/teardown/measurements';

describe('parseProbe', () => {
  test('reads length, size, frame rate and whether there is sound', () => {
    const json = JSON.stringify({
      streams: [
        { codec_type: 'video', width: 1920, height: 1080, avg_frame_rate: '30000/1001' },
        { codec_type: 'audio' },
      ],
      format: { duration: '1409.48' },
    });
    expect(parseProbe(json)).toEqual({
      durationSeconds: 1409.48,
      width: 1920,
      height: 1080,
      fps: 29.97,
      hasAudio: true,
    });
  });

  test('falls back to the stream length and the base frame rate; no audio when none is listed', () => {
    const json = JSON.stringify({
      streams: [
        { codec_type: 'video', duration: '12', avg_frame_rate: '0/0', r_frame_rate: '25/1' },
      ],
      format: {},
    });
    expect(parseProbe(json)).toEqual({
      durationSeconds: 12,
      width: null,
      height: null,
      fps: 25,
      hasAudio: false,
    });
  });

  test('is null for text that is not JSON or a file with no length', () => {
    expect(parseProbe('not json')).toBeNull();
    expect(parseProbe(JSON.stringify({ streams: 'x', format: { duration: '0' } }))).toBeNull();
    expect(frameRate(7)).toBeNull();
  });
});

describe('ffmpeg output', () => {
  test('cut times come from showinfo, sorted, without repeats or the first frame', () => {
    const stderr = [
      '[Parsed_showinfo_1 @ 0x1] n:   1 pts: 175 pts_time:7  duration:1',
      '[Parsed_showinfo_1 @ 0x1] n:   0 pts:  75 pts_time:3  duration:1',
      '[Parsed_showinfo_1 @ 0x1] n:   2 pts:  75 pts_time:3  duration:1',
      '[Parsed_showinfo_1 @ 0x1] n:   3 pts:   0 pts_time:0  duration:1',
    ].join('\n');
    expect(parseSceneCuts(stderr)).toEqual([3, 7]);
  });

  test('the ebur128 summary gives integrated loudness, range and true peak', () => {
    const stderr = `frame line I: -99 LUFS\n[Parsed_ebur128_0 @ 0x1] Summary:\n\n  Integrated loudness:\n    I:         -17.1 LUFS\n    Threshold: -27.4 LUFS\n\n  Loudness range:\n    LRA:         3.5 LU\n\n  True peak:\n    Peak:        0.1 dBFS`;
    expect(parseEbur128(stderr)).toEqual({ integratedLufs: -17.1, lraLu: 3.5, truePeakDbfs: 0.1 });
    expect(parseEbur128('nothing here')).toEqual({
      integratedLufs: null,
      lraLu: null,
      truePeakDbfs: null,
    });
  });

  test('silences pair start and end, and one open at the end closes at the end', () => {
    const stderr =
      'silence_start: 3.99998\nsilence_end: 6.00004 | silence_duration: 2\nsilence_end: 8\nsilence_start: 11.5';
    expect(parseSilences(stderr, 12)).toEqual([
      { start: 4, end: 6 },
      { start: 11.5, end: 12 },
    ]);
    expect(parseSilences('silence_start: 12', 12)).toEqual([]);
  });

  test('peak windows pair each time with its peak, silence as minus infinity', () => {
    const stderr = [
      'frame:0 pts:0 pts_time:0',
      'lavfi.astats.Overall.Peak_level=-20.0',
      'frame:1 pts:24000 pts_time:0.5',
      'lavfi.astats.Overall.Peak_level=-inf',
      'lavfi.astats.Overall.Peak_level=-3',
      'frame:2 pts:48000 pts_time:1',
      'lavfi.astats.Overall.Peak_level=-0.9',
    ].join('\n');
    const windows = parsePeakWindows(stderr);
    expect(windows).toEqual([
      { at: 0, peakDb: -20 },
      { at: 0.5, peakDb: -Infinity },
      { at: 1, peakDb: -0.9 },
    ]);
    expect(peakImpacts(windows, -12)).toEqual([{ at: 1, peakDb: -0.9 }]);
    expect(
      peakImpacts(
        [
          { at: 0, peakDb: -1 },
          { at: 1, peakDb: -2 },
          { at: 2, peakDb: -20 },
          { at: 3, peakDb: -5 },
        ],
        -12,
      ).map((window) => window.at),
    ).toEqual([0, 3]);
  });
});

describe('shots', () => {
  test('median of odd, even and empty lists', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBe(0);
  });

  test('shots run from cut to cut, and a span counts its own cuts and shot parts', () => {
    expect(shotSpans([3, 7, 9, 20], 12)).toEqual([
      { start: 0, end: 3 },
      { start: 3, end: 7 },
      { start: 7, end: 9 },
      { start: 9, end: 12 },
    ]);
    expect(shotStats([3, 7, 9], { start: 0, end: 12 })).toEqual({
      cutCount: 3,
      shotCount: 4,
      medianSeconds: 3,
      averageSeconds: 3,
      cutsPerMinute: 15,
    });
    expect(shotStats([3, 7, 9], { start: 6, end: 6 })).toMatchObject({
      cutCount: 0,
      cutsPerMinute: 0,
    });
  });
});

describe('words', () => {
  const lines = [
    { at: 0, text: 'This is a long opening sentence that sets' },
    { at: 3, text: 'the scene. Who decides? One person.' },
    { at: 8, text: '[Music] <i>It ends</i> here' },
  ];

  test('sentences run across lines and are timed by the line they start in', () => {
    expect(sentencesOf(lines)).toEqual([
      { at: 0, text: 'This is a long opening sentence that sets the scene.', words: 10 },
      { at: 3, text: 'Who decides?', words: 2 },
      { at: 3, text: 'One person.', words: 2 },
      { at: 8, text: 'It ends here', words: 3 },
    ]);
  });

  test('counts words, pace, sentence length and hammer sentences, sound tags left out', () => {
    expect(wordStats(lines, { start: 0, end: 12 })).toEqual({
      wordCount: 17,
      wordsPerMinute: 85,
      sentenceCount: 4,
      medianSentenceWords: 2.5,
      averageSentenceWords: 4.3,
      hammers: [
        { at: 3, text: 'Who decides?', words: 2 },
        { at: 3, text: 'One person.', words: 2 },
        { at: 8, text: 'It ends here', words: 3 },
      ],
    });
    expect(wordStats(lines, { start: 20, end: 20 })).toMatchObject({
      wordCount: 0,
      wordsPerMinute: 0,
      averageSentenceWords: 0,
    });
  });

  test('a quote is found word for word, whatever its case and punctuation', () => {
    expect(quoteFound(lines, 'who DECIDES — one person')).toBe(true);
    expect(quoteFound(lines, 'nobody decides')).toBe(false);
    expect(quoteFound(lines, '...')).toBe(false);
  });
});

describe('palette', () => {
  const solid = (r: number, g: number, b: number, pixels = 4): Uint8Array =>
    Uint8Array.from({ length: pixels * 3 }, (_, index) => [r, g, b][index % 3] ?? 0);

  test('groups colours and weighs each by the seconds its frame stands for', () => {
    const colours = dominantColours([
      { rgb: solid(255, 0, 0), weight: 3 },
      { rgb: solid(0, 0, 255), weight: 4 },
      { rgb: solid(255, 255, 255), weight: 2 },
      { rgb: solid(0, 128, 0), weight: 3 },
    ]);
    expect(colours).toEqual([
      { hex: '#0000FF', share: 0.333 },
      { hex: '#FF0000', share: 0.25 },
      { hex: '#008000', share: 0.25 },
      { hex: '#FFFFFF', share: 0.167 },
    ]);
  });

  test('leaves out colours under the smallest share, and gives nothing for no pixels', () => {
    const colours = dominantColours(
      [
        { rgb: solid(0, 0, 0), weight: 99 },
        { rgb: solid(250, 250, 250), weight: 1 },
      ],
      4,
      0.02,
    );
    expect(colours).toEqual([{ hex: '#000000', share: 0.99 }]);
    expect(dominantColours([])).toEqual([]);
    expect(dominantColours([{ rgb: new Uint8Array(2), weight: 1 }])).toEqual([]);
    expect(hexOf([300, -4, 15.6])).toBe('#FF0010');
  });
});

describe('planKeyframes', () => {
  test('one per shot, in the middle of it', () => {
    expect(
      planKeyframes([
        { start: 0, end: 3 },
        { start: 3, end: 7 },
      ]),
    ).toEqual([
      { id: 'k-001', at: 1.5, shot: 0, covers: 3 },
      { id: 'k-002', at: 5, shot: 1, covers: 4 },
    ]);
  });

  test('more shots than allowed: runs of neighbours, each shown by its longest shot', () => {
    const shots = [
      { start: 0, end: 1 },
      { start: 1, end: 4 },
      { start: 4, end: 5 },
      { start: 5, end: 6 },
      { start: 6, end: 10 },
    ];
    expect(planKeyframes(shots, 2)).toEqual([
      { id: 'k-001', at: 2.5, shot: 1, covers: 4 },
      { id: 'k-002', at: 8, shot: 4, covers: 6 },
    ]);
  });
});

describe('parseMeasurements', () => {
  test('refuses text that is not measurements', () => {
    expect(parseMeasurements('{')).toBeNull();
    expect(parseMeasurements('{"version":2}')).toBeNull();
  });
});
