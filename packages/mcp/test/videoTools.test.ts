import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { beforeEach, describe, expect, test } from 'vitest';
import { createToolHandlers, type ToolHandlers } from '../src/tools';
import {
  ALPHA_ID,
  FakeEngine,
  VIDEO_ID,
  brandResult,
  textOf,
  transcriptResult,
  videoDetails,
} from './fakes';

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9, 9]);
const JPEG_BASE64 = Buffer.from(JPEG).toString('base64');

let engine: FakeEngine;
let tools: ToolHandlers;
let fetched: string[];
let imageAnswer: (url: string) => Response;

beforeEach(() => {
  engine = new FakeEngine();
  fetched = [];
  imageAnswer = () => new Response(JPEG, { headers: { 'content-type': 'image/jpeg' } });
  tools = createToolHandlers({
    engine,
    log: () => {},
    fetchImage: async (url) => {
      fetched.push(url);
      return imageAnswer(url);
    },
  });
});

/** The first text part of a result, parsed: the facts every one of these tools opens with. */
const headOf = (result: CallToolResult): Record<string, unknown> => {
  const [first] = result.content;
  return JSON.parse(first?.type === 'text' ? first.text : '{}') as Record<string, unknown>;
};

const textAt = (result: CallToolResult, index: number): string => {
  const part = result.content[index];
  return part?.type === 'text' ? part.text : '';
};

describe('get_transcript', () => {
  test('returns the captions as text with a time mark every half minute or so', async () => {
    const result = await tools.getTranscript({ video: VIDEO_ID });

    expect(result.isError).toBeUndefined();
    expect(headOf(result)).toEqual({
      video: VIDEO_ID,
      lang: 'en',
      auto: true,
      lines: 12,
      lastLineAt: '1:50',
      words: 36,
      wordsPerMinute: 20,
    });
    expect(textAt(result, 1).split('\n')).toEqual([
      '[0:00] caption line 0 caption line 1 caption line 2',
      '[0:30] caption line 3 caption line 4 caption line 5',
      '[1:00] caption line 6 caption line 7 caption line 8',
      '[1:30] caption line 9 caption line 10 caption line 11',
    ]);
    expect(engine.reads).toEqual([['transcript', VIDEO_ID]]);
  });

  test('accepts a link to the video', async () => {
    await tools.getTranscript({ video: `https://youtu.be/${VIDEO_ID}?si=x` });

    expect(engine.reads).toEqual([['transcript', VIDEO_ID]]);
  });

  test('cuts a long transcript at a time mark and says where to carry on', async () => {
    engine.transcript = transcriptResult(600);

    const result = await tools.getTranscript({ video: VIDEO_ID, max_chars: 1000 });

    expect(textAt(result, 1).length).toBeLessThanOrEqual(1000);
    const { cut } = headOf(result) as { cut: { at: string; startSeconds: number; note: string } };
    expect(cut.note).toBe(
      `Cut at ${cut.at} to fit max_chars. Call again with start_seconds ${cut.startSeconds} for the rest.`,
    );
    expect(cut.startSeconds % 30).toBe(0);

    const rest = await tools.getTranscript({
      video: VIDEO_ID,
      max_chars: 1000,
      start_seconds: cut.startSeconds,
    });
    expect(textAt(rest, 1).startsWith(`[${cut.at}]`)).toBe(true);
    expect(headOf(rest)).toMatchObject({ from: cut.at });
  });

  test('keeps to a default length when none is given', async () => {
    engine.transcript = transcriptResult(5000);

    const result = await tools.getTranscript({ video: VIDEO_ID });

    expect(textAt(result, 1).length).toBeLessThanOrEqual(12_000);
    expect(headOf(result)).toHaveProperty('cut');
  });

  test('says a video has no captions as a normal answer, not an error', async () => {
    engine.transcript = transcriptResult(0, { transcript: null });

    const result = await tools.getTranscript({ video: VIDEO_ID });

    expect(result.isError).toBeUndefined();
    expect(result.content).toHaveLength(1);
    expect(headOf(result)).toEqual({
      video: VIDEO_ID,
      captions: false,
      note: 'YouTube lists no captions for this video.',
    });
  });

  test('says so when the moment asked for is past the last caption', async () => {
    const result = await tools.getTranscript({ video: VIDEO_ID, start_seconds: 9000 });

    expect(headOf(result)).toMatchObject({ note: 'Nothing is said after 2:30:00.' });
    expect(result.content).toHaveLength(1);
  });

  test.each([
    [
      { video: 'not a video' },
      'video is a YouTube video id (11 characters) or a link to one video.',
    ],
    [{ video: VIDEO_ID, max_chars: 10 }, 'max_chars is a whole number from 1000 to 40000.'],
    [{ video: VIDEO_ID, start_seconds: -1 }, 'start_seconds is a whole number from 0 to 86400.'],
  ])('refuses %j before anything is read', async (args, message) => {
    const result = await tools.getTranscript(args);

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(message);
    expect(engine.reads).toEqual([]);
  });

  test('turns a failed read into one plain sentence', async () => {
    engine.readTranscript = () =>
      Promise.reject(new Error('The captions of video x could not be read\n  at /srv/app/x.ts'));

    const result = await tools.getTranscript({ video: VIDEO_ID });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('The captions of video x could not be read');
  });
});

describe('view_video_frames', () => {
  test('returns each sheet as a picture under the caption that says how to read it', async () => {
    const result = await tools.viewVideoFrames({ video: VIDEO_ID, sheets: 3 });

    expect(result.isError).toBeUndefined();
    expect(headOf(result)).toEqual({
      video: VIDEO_ID,
      source:
        'YouTube’s own preview frames: small pictures taken every few seconds, not every frame of the video.',
      sheets: 3,
      shown: 2,
      ofSheets: 7,
      frames: 157,
      frame: '160x90',
      note: 'These sheets are a sample spread across the video. To see every frame, call with start_sheet 1 and follow next.',
    });
    expect(result.content.slice(1)).toEqual([
      { type: 'text', text: 'Sheet 1 of 7: a grid 5 across and 5 down.' },
      {
        type: 'image',
        data: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 7, 7]).toString('base64'),
        mimeType: 'image/jpeg',
      },
      { type: 'text', text: 'Sheet 4 of 7 could not be shown: it took too long to load' },
      { type: 'text', text: 'Sheet 7 of 7: a grid 5 across and 5 down.' },
      {
        type: 'image',
        data: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 7, 7]).toString('base64'),
        mimeType: 'image/jpeg',
      },
    ]);
    expect(engine.reads).toEqual([['frames', VIDEO_ID, 3]]);
  });

  test('asks for four sheets unless told otherwise', async () => {
    await tools.viewVideoFrames({ video: VIDEO_ID });

    expect(engine.reads).toEqual([['frames', VIDEO_ID, 4]]);
  });

  test('says a video has no frames to show as a normal answer', async () => {
    engine.frames = null;

    const result = await tools.viewVideoFrames({ video: VIDEO_ID });

    expect(result.isError).toBeUndefined();
    expect(headOf(result)).toEqual({
      video: VIDEO_ID,
      frames: false,
      note: 'YouTube has no storyboard of frames for this video.',
    });
  });

  test('is an error only when no sheet could be shown at all', async () => {
    const all = engine.frames;
    engine.frames = all && { ...all, sheets: all.sheets.filter((entry) => !entry.image.ok) };

    const result = await tools.viewVideoFrames({ video: VIDEO_ID });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('could not be shown');
  });

  test('walks the sheets in a row from start_sheet, and says where to call again from', async () => {
    const all = engine.frames!;
    const sheet = (index: number) => ({
      ...all.sheets[0]!,
      sheet: { ...all.sheets[0]!.sheet, index },
    });
    engine.frames = { ...all, sheets: [sheet(0), sheet(1), sheet(2), sheet(3)] };

    const result = await tools.viewVideoFrames({ video: VIDEO_ID, start_sheet: 1 });

    expect(headOf(result)).toMatchObject({
      ofSheets: 7,
      frames: 157,
      from: 1,
      to: 4,
      next: {
        start_sheet: 5,
        note: 'You have seen sheets 1 to 4 of 7. Call again with start_sheet 5.',
      },
    });
    expect(headOf(result)).not.toHaveProperty('last');
    // The tool counts sheets from 1; the engine from 0.
    expect(engine.reads).toEqual([['frames', VIDEO_ID, 4, 0]]);
  });

  test('says when the sheets it holds are the last of the video', async () => {
    const all = engine.frames!;
    const sheet = (index: number) => ({
      ...all.sheets[0]!,
      sheet: { ...all.sheets[0]!.sheet, index },
    });
    engine.frames = { ...all, sheets: [sheet(4), sheet(5), sheet(6)] };

    const result = await tools.viewVideoFrames({ video: VIDEO_ID, start_sheet: 5, sheets: 6 });

    expect(headOf(result)).toMatchObject({ from: 5, to: 7, last: true });
    expect(headOf(result)).not.toHaveProperty('next');
    expect(engine.reads).toEqual([['frames', VIDEO_ID, 6, 4]]);
  });

  test('answers, without an error, when asked to start past the last sheet', async () => {
    engine.frames = { ...engine.frames!, sheets: [] };

    const result = await tools.viewVideoFrames({ video: VIDEO_ID, start_sheet: 9 });

    expect(result.isError).toBeUndefined();
    expect(headOf(result)).toMatchObject({
      shown: 0,
      last: true,
      note: 'There is no sheet 9: the video has 7.',
    });
  });

  test('says when the frames were cut from the video file itself', async () => {
    engine.frames = { ...engine.frames!, source: 'file' };

    const result = await tools.viewVideoFrames({ video: VIDEO_ID, start_sheet: 1 });

    expect(headOf(result)).toMatchObject({
      source: 'Cut from the video file itself, one frame every second.',
    });
  });

  test('refuses a start_sheet that is not a sheet number, before anything is read', async () => {
    const result = await tools.viewVideoFrames({ video: VIDEO_ID, start_sheet: 0 });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('start_sheet is a whole number from 1 to 2000.');
    expect(engine.reads).toEqual([]);
  });

  test('refuses more sheets than the limit, before anything is read', async () => {
    const result = await tools.viewVideoFrames({ video: VIDEO_ID, sheets: 7 });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('sheets is a whole number from 1 to 6.');
    expect(engine.reads).toEqual([]);
  });
});

describe('get_channel_brand', () => {
  test('returns the facts as text, then the logo and the cover as pictures', async () => {
    const result = await tools.getChannelBrand({ channel: '@alpha' });

    expect(result.isError).toBeUndefined();
    expect(headOf(result)).toEqual({
      id: ALPHA_ID,
      title: 'Alpha',
      handle: 'alpha',
      subs: 5000,
      bio: 'We explain new inventions.',
      keywords: ['inventions', 'engineering'],
      links: ['alpha.example'],
      logo: '900x900',
      cover: '1060x175',
    });
    expect(result.content.slice(1)).toEqual([
      { type: 'text', text: 'Logo of Alpha:' },
      { type: 'image', data: JPEG_BASE64, mimeType: 'image/jpeg' },
      { type: 'text', text: 'Cover of Alpha:' },
      { type: 'image', data: JPEG_BASE64, mimeType: 'image/jpeg' },
    ]);
    // A logo wide enough to read, and a cover well under full size.
    expect(fetched).toEqual([
      'https://yt3.googleusercontent.com/logo=s900',
      'https://yt3.googleusercontent.com/cover=w1060',
    ]);
    expect(engine.reads).toEqual([
      ['brand', '@alpha'],
      ['money', [ALPHA_ID]],
    ]);
  });

  test('carries the stored monetization verdict and the sign it rests on', async () => {
    engine.money = [
      {
        channelId: ALPHA_ID,
        status: 'monetized',
        says: 'Monetized (sign: memberships)',
        short: '$ Monetized',
        sign: 'Its watch page offers a Join button.',
        checkedAt: '2026-11-21T10:00:00.000Z',
        videoId: VIDEO_ID,
        bar: { key: 'over-1000', says: '1,000+ subscribers', subscribers: 5000, note: 'n' },
      },
    ];
    const head = headOf(await tools.getChannelBrand({ channel: ALPHA_ID, images: false }));
    expect(head['money']).toEqual({
      says: 'Monetized (sign: memberships)',
      sign: 'Its watch page offers a Join button.',
      at: '2026-11-21T10:00:00.000Z',
      bar: '1,000+ subscribers',
    });
  });

  test('gives the facts alone when the pictures are not wanted', async () => {
    const result = await tools.getChannelBrand({ channel: ALPHA_ID, images: false });

    expect(result.content).toHaveLength(1);
    expect(fetched).toEqual([]);
  });

  test('says what a channel has not set, and shows no picture it does not have', async () => {
    const plain = brandResult();
    engine.brand = {
      ...plain,
      brand: plain.brand && {
        ...plain.brand,
        description: '',
        banner: [],
        keywords: [],
        links: [],
      },
    };

    const result = await tools.getChannelBrand({ channel: ALPHA_ID });

    expect(headOf(result)).toEqual({
      id: ALPHA_ID,
      title: 'Alpha',
      handle: 'alpha',
      subs: 5000,
      bio: '',
      logo: '900x900',
      cover: false,
    });
    expect(result.content).toHaveLength(3);
  });

  test('reports a picture that could not be loaded in words, beside the facts', async () => {
    imageAnswer = (url) =>
      url.includes('cover')
        ? new Response('', { status: 404 })
        : new Response(JPEG, { headers: { 'content-type': 'image/jpeg' } });

    const result = await tools.getChannelBrand({ channel: ALPHA_ID });

    expect(result.isError).toBeUndefined();
    expect(textAt(result, 3)).toBe(
      'Cover of Alpha could not be shown: YouTube has no channel image for it (status 404)',
    );
  });

  test('cuts a very long bio and says so', async () => {
    const long = brandResult();
    engine.brand = {
      ...long,
      brand: long.brand && { ...long.brand, description: 'b'.repeat(5000) },
    };

    const head = headOf(await tools.getChannelBrand({ channel: ALPHA_ID, images: false }));

    expect((head['bio'] as string).length).toBe(2000);
    expect(head['bioCut']).toBe(true);
  });

  test('says so when the channel’s page gave no branding, and refuses a bad channel', async () => {
    engine.brand = { ...brandResult(), brand: null };

    const none = await tools.getChannelBrand({ channel: ALPHA_ID });
    const bad = await tools.getChannelBrand({ channel: 'https://evil.example/x' });

    expect(headOf(none)).toMatchObject({ id: ALPHA_ID, branding: false });
    expect(bad.isError).toBe(true);
    expect(engine.reads.filter(([kind]) => kind === 'brand')).toHaveLength(1);
  });
});

describe('get_video_details', () => {
  test('returns each video’s title, description, tags, length, views and score', async () => {
    const result = await tools.getVideoDetails({ video_ids: ['aaaaaaaaaa1', 'zzzzzzzzzz9'] });

    const data = headOf(result) as {
      shown: number;
      videos: Array<Record<string, unknown>>;
      problems: unknown;
    };
    expect(data.shown).toBe(2);
    expect(data.videos[0]).toEqual({
      video: 'aaaaaaaaaa1',
      title: 'America Just Built The Impossible',
      description: 'A long description. '.repeat(200).slice(0, 1500),
      descriptionCut: true,
      tags: ['invention', 'america'],
      secs: 754,
      views: 90_000,
      score: 8.3,
      channelId: ALPHA_ID,
    });
    // A video no crawl has stored: no views or score, and absent values are left out.
    expect(data.videos[1]).toEqual({ video: 'zzzzzzzzzz9', description: '', tags: [] });
    expect(data.problems).toEqual([{ video: 'qqqqqqqqqq1', reason: 'This video is unavailable' }]);
    expect(result.content).toHaveLength(1);
    expect(textOf(result)).not.toContain('\n');
    expect(engine.reads).toEqual([['details', ['aaaaaaaaaa1', 'zzzzzzzzzz9']]]);
  });

  test('gives more of each description when asked, and asks about a repeated id once', async () => {
    const result = await tools.getVideoDetails({
      video_ids: ['aaaaaaaaaa1', 'aaaaaaaaaa1'],
      description_chars: 5000,
    });

    const [first] = (headOf(result) as { videos: Array<Record<string, unknown>> }).videos;
    expect((first?.['description'] as string).length).toBe(4000);
    expect(first).not.toHaveProperty('descriptionCut');
    expect(engine.reads).toEqual([['details', ['aaaaaaaaaa1']]]);
  });

  test('says why the official API could not be used, when it was asked and refused', async () => {
    engine.details = {
      ...videoDetails(),
      problems: [],
      apiProblem: 'The daily allowance is used up.',
    };

    const data = headOf(await tools.getVideoDetails({ video_ids: ['aaaaaaaaaa1'] }));

    expect(data).not.toHaveProperty('problems');
    expect(data['note']).toBe(
      'The official API could not be used (The daily allowance is used up.), so each video’s own page was read.',
    );
  });

  test.each([
    [{ video_ids: [] }, 'Give 1 to 10 video ids at a time.'],
    [
      { video_ids: Array.from({ length: 11 }, (_, n) => `aaaaaaaaa${String(n).padStart(2, '0')}`) },
      'Give 1 to 10 video ids at a time.',
    ],
    [
      { video_ids: ['../../etc/passwd'] },
      'Video ids are 11 characters: letters, digits, "-" and "_".',
    ],
  ])('refuses %j before anything is read', async (args, message) => {
    const result = await tools.getVideoDetails(args);

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(message);
    expect(engine.reads).toEqual([]);
  });

  test('is an error when none of the videos could be read', async () => {
    engine.details = {
      videos: [],
      problems: [{ videoId: 'qqqqqqqqqq1', reason: 'This video is unavailable' }],
      apiProblem: null,
    };

    const result = await tools.getVideoDetails({ video_ids: ['qqqqqqqqqq1'] });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(
      'None of those videos could be read. qqqqqqqqqq1: This video is unavailable',
    );
  });
});
