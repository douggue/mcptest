import type { PacingView } from '@jgtube/core';
import { describe, expect, test } from 'vitest';
import { createExtrasApi } from '../src/lib/extrasApi';
import { chartRows, restsOn, shortsNote, spreadText, winnersRule } from '../src/lib/pacing';

const CHANNEL = 'UCHnyfMqiRRG1u-2MsSQLbXA';
const own = { count: 12, median: 600, lower: 480, upper: 720 };
const winners = { count: 9, median: 1200, lower: 900, upper: 1500 };
const none = { count: 0, median: null, lower: null, upper: null };

describe('the pacing wording', () => {
  test('gives a spread in minutes or words a minute, with the middle half', () => {
    expect(spreadText(own, 'length')).toBe('10:00 median · middle half 8:00 to 12:00');
    expect(spreadText({ count: 3, median: 152.4, lower: 140, upper: 160.6 }, 'pace')).toBe(
      '152 words a minute median · middle half 140 to 161',
    );
    expect(spreadText(none, 'length')).toBe('Nothing to measure');
  });

  test('says how many videos a figure rests on', () => {
    expect(restsOn(own, 'length')).toBe('from 12 videos');
    expect(restsOn({ ...own, count: 1 }, 'pace')).toBe('from 1 video with captions stored');
    expect(restsOn(none, 'pace')).toBe('no video with captions stored');
  });

  test('says which videos count as winners and which Shorts were left out', () => {
    expect(winnersRule({ minScore: 2, windowDays: 30, perChannel: 4 }, 22)).toBe(
      "Winners are the breakouts of the 22 look-alikes on this map: videos of the last 30 days at 2× their channel's usual views or more, at most 4 from one channel.",
    );
    expect(shortsNote({ own: 3, winners: 1 })).toBe(
      'Shorts (a minute or less) are left out: 3 of yours and 1 of the winners’.',
    );
    expect(shortsNote({ own: 0, winners: 0 })).toBeNull();
  });
});

describe('chartRows', () => {
  test('places each middle half and median on one shared scale, in percent', () => {
    const rows = chartRows([
      { label: 'Yours', spread: own },
      { label: 'Winners', spread: winners },
      { label: 'Empty', spread: none },
    ]);

    expect(rows).toEqual([
      { label: 'Yours', from: 24, to: 36, at: 30, count: 12 },
      { label: 'Winners', from: 45, to: 75, at: 60, count: 9 },
      { label: 'Empty', from: null, to: null, at: null, count: 0 },
    ]);
  });
});

describe('the pacing API', () => {
  test("reads a channel's lengths and pace", async () => {
    const view: PacingView = {
      centerChannelId: CHANNEL,
      lengths: { own, winners },
      shortsLeftOut: { own: 0, winners: 0 },
      wordsPerMinute: { own: none, winners: none },
      rule: { minScore: 2, windowDays: 30, perChannel: 4 },
      lookalikes: 3,
    };
    const sent: string[] = [];
    const api = createExtrasApi(async (url) => {
      sent.push(String(url));
      return new Response(JSON.stringify({ success: true, data: view, error: null }));
    });

    await expect(api.pacing(CHANNEL)).resolves.toEqual(view);
    expect(sent).toEqual([`/api/pacing?channel=${CHANNEL}`]);
  });
});
