import type { BankVideo } from '@jgtube/core';
import { describe, expect, test } from 'vitest';
import { createBankApi } from '../src/lib/bank';
import type { TeardownView } from '../src/lib/teardown';
import {
  TEARDOWN_PARTS,
  measuredFacts,
  paletteOf,
  scoreBasis,
  scoreLine,
  storedFacts,
  timelineOf,
  videoTabs,
  viewsLine,
} from '../src/lib/videoPage';

const ID = 'dQw4w9WgXcQ';
const video = (over: Partial<BankVideo> = {}): BankVideo =>
  ({
    videoId: ID,
    title: 'A title',
    views: 941_000,
    ageDays: 8,
    publishedRaw: '8 days ago',
    durationSeconds: 2205,
    isShort: false,
    score: 269,
    baseline: 3500,
    sampleSize: 30,
    caution: null,
    viewsPerDay: 117_625,
    channel: { id: 'UC0UJp3kmO7wf33XFf56gbTw', title: 'A channel' },
    ...over,
  }) as BankVideo;

const teardown = (over: Record<string, unknown> = {}): TeardownView =>
  ({
    measured: {
      video: { durationSeconds: 2205 },
      shots: { cutCount: 412, averageSeconds: 5.3 },
      palette: {
        items: [
          { hex: '#111111', share: 0.2 },
          { hex: '#D97706', share: 0.5 },
          { hex: '#FFD60A', share: 0.1 },
        ],
      },
    },
    transcript: { words: { wordCount: 6170, wordsPerMinute: 168 } },
    chapters: {
      from: 'engine',
      items: [
        { title: 'Hook', role: 'hook', start: 0, end: 42 },
        { title: 'Proof', role: 'proof', start: 42, end: 2205 },
      ],
    },
    ...over,
  }) as unknown as TeardownView;

describe('a video’s page', () => {
  test('has four tabs, each at its own address, Summary first', () => {
    expect(videoTabs(ID)).toEqual([
      { key: 'summary', label: 'Summary', href: `#/video/${ID}` },
      { key: 'teardown', label: 'Teardown', href: `#/video/${ID}/teardown` },
      { key: 'thumbnail', label: 'Thumbnail', href: `#/video/${ID}/thumbnail` },
      { key: 'hook', label: 'Hook and script', href: `#/video/${ID}/hook` },
    ]);
    expect(TEARDOWN_PARTS).toHaveLength(8);
  });

  test('says how far above its channel’s usual it is, and what that rests on', () => {
    expect(scoreLine(video())).toBe('269× its channel’s usual');
    expect(scoreLine(video({ score: null }))).toBeNull();
    expect(viewsLine(video())).toBe('941K views · 8 days ago');
    expect(scoreBasis(video())).toBe(
      'Its views over its channel’s usual 3.5K views at the same age, from 30 other videos.',
    );
    expect(
      scoreBasis(video({ sampleSize: 1, caution: 'few-videos' as BankVideo['caution'] })),
    ).toBe(
      'Its views over its channel’s usual 3.5K views at the same age, from 1 other video. Read it with care: the comparison rests on little.',
    );
    expect(scoreBasis(video({ sampleSize: null }))).toContain('from 0 other videos');
    expect(scoreBasis(video({ score: null, baseline: null }))).toBe(
      'Not scored: its channel has too few stored videos to compare against.',
    );
  });

  test('lists what is stored about it, each number with what it rests on', () => {
    expect(storedFacts(video())).toEqual([
      { label: 'Score', value: '269×', note: 'Usual: 3.5K views', score: true },
      { label: 'Views', value: '941K', note: '117.6K a day on average' },
      { label: 'Uploaded', value: '8 days ago', note: 'Dated by YouTube' },
      { label: 'Length', value: '36:45', note: '37 minutes' },
    ]);
    const unscored = storedFacts(video({ score: null, baseline: null }));
    expect(unscored[0]).toEqual({
      label: 'Score',
      value: '—',
      note: 'Too few videos to compare',
      score: false,
    });
    const short = storedFacts(video({ isShort: true, durationSeconds: 45 }));
    expect(short[3]).toEqual({ label: 'Length', value: 'Short', note: '45 seconds' });
    const unread = storedFacts(video({ durationSeconds: null }));
    expect(unread[3]).toEqual({ label: 'Length', value: '—', note: 'Not read' });
    expect(storedFacts(video({ durationSeconds: 60 }))[3]?.note).toBe('1 minute');
  });

  test('lists what was measured in its file, and nothing before it is measured', () => {
    expect(measuredFacts(teardown())).toEqual([
      { label: 'Cuts', value: '412', note: 'one every 5.3 s' },
      { label: 'Words a minute', value: '168', note: '6.2K words in all' },
      { label: 'Runtime', value: '36:45', note: 'measured from the file' },
    ]);
    expect(measuredFacts(teardown({ transcript: { words: null } }))[1]).toEqual({
      label: 'Words a minute',
      value: '—',
      note: 'No words were read',
    });
    expect(measuredFacts(teardown({ measured: null }))).toEqual([]);
  });

  test('shows its main colours, most used first', () => {
    expect(paletteOf(teardown())).toEqual(['#D97706', '#111111', '#FFD60A']);
    expect(paletteOf(teardown({ measured: null }))).toEqual([]);
  });

  test('lays its chapters on a timeline, each as wide as its share of the runtime', () => {
    const timeline = timelineOf(teardown());
    expect(timeline?.end).toBe('36:45');
    expect(timeline?.named).toBe(true);
    expect(timeline?.parts.map((part) => [part.title, part.role, part.at])).toEqual([
      ['Hook', 'hook', '0:00'],
      ['Proof', 'proof', '0:42'],
    ]);
    expect(timeline?.parts[0]?.share).toBeCloseTo(42 / 2205);
    expect(timelineOf(teardown({ chapters: { from: 'even', items: [] } }))).toBeNull();
    const even = teardown({
      chapters: { from: 'even', items: [{ title: 'Part 1', role: '', start: 0, end: 10 }] },
    });
    expect(timelineOf(even)?.named).toBe(false);
  });
});

describe('reading one stored video', () => {
  test('asks the bank by the video’s id, and is null when it is not stored', async () => {
    const calls: string[] = [];
    const answering = (found: unknown) =>
      createBankApi(async (path) => {
        calls.push(String(path));
        return new Response(JSON.stringify({ success: true, data: { found }, error: null }), {
          headers: { 'content-type': 'application/json' },
        });
      });
    const look = { video: video(), collections: [], saved: [3] };
    expect(await answering(look).video(ID)).toEqual(look);
    expect(await answering(null).video(ID)).toBeNull();
    expect(calls[0]).toBe(`/api/bank/video?video=${ID}`);
  });
});
