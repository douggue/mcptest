import type { LinkedVideo, PlanTableRow, PlanView } from '@jgtube/core';
import { describe, expect, test } from 'vitest';
import { createExtrasApi } from '../src/lib/extrasApi';
import {
  KIND_LABELS,
  daysText,
  inspirationLine,
  medianText,
  scoreLine,
  tableCaution,
} from '../src/lib/plan';

const CHANNEL = 'UCHnyfMqiRRG1u-2MsSQLbXA';

const linked: LinkedVideo = {
  conceptId: 3,
  conceptTitle: 'Plan',
  videoId: 'abcdefghijk',
  videoTitle: 'My video',
  views: 6000,
  ageDays: 9.4,
  score: 2.31,
  usualViews: 2600,
  durationSeconds: 600,
  format: null,
  hookStyle: null,
  hasScript: true,
  inspirations: [],
};

describe('daysText', () => {
  test('gives an age in whole days', () => {
    expect(daysText(0.3)).toBe('under a day');
    expect(daysText(1.2)).toBe('1 day');
    expect(daysText(9.4)).toBe('9 days');
  });
});

describe('scoreLine', () => {
  test("says the views, age and score against the channel's usual at that age", () => {
    expect(scoreLine(linked)).toBe(
      "6K views at 9 days old: 2.3× what this channel's videos usually have at that age (about 2.6K).",
    );
    expect(scoreLine({ ...linked, score: null, usualViews: null })).toBe(
      '6K views at 9 days old. Not scored: the channel has too few other videos to compare with.',
    );
  });
});

describe('inspirationLine', () => {
  const base = { videoId: 'x', title: 'Their video', channelTitle: 'Them' };

  test('gives views at the same age, or why they cannot be compared', () => {
    expect(
      inspirationLine(
        { ...base, match: { status: 'comparable', ageDays: 8.6, views: 4000 } },
        6000,
      ),
    ).toBe('At 9 days old it had 4K views (read then); yours has 6K at the same age.');
    expect(
      inspirationLine(
        { ...base, match: { status: 'not-comparable', reason: 'no-reading-near-age' } },
        6000,
      ),
    ).toBe('Not comparable: it was not read at about the same age.');
    expect(
      inspirationLine(
        { ...base, match: { status: 'not-comparable', reason: 'date-too-rough' } },
        6000,
      ),
    ).toBe('Not comparable: an upload date is known only roughly.');
    expect(
      inspirationLine(
        {
          videoId: 'x',
          title: null,
          channelTitle: null,
          match: { status: 'not-comparable', reason: 'not-stored' },
        },
        6000,
      ),
    ).toBe('Not comparable: this video is no longer stored.');
  });
});

describe('the table', () => {
  const row: PlanTableRow = { kind: 'format', label: 'F', videos: 3, scored: 2, medianScore: 1.84 };

  test('names each kind and gives the median of those scored', () => {
    expect(KIND_LABELS).toEqual({ format: 'Title format', hook: 'Hook style', length: 'Length' });
    expect(medianText(row)).toBe('1.8× (median of 2 scored)');
    expect(medianText({ ...row, scored: 0, medianScore: null })).toBe('No score yet');
  });

  test('says how many videos it rests on, and that a handful proves little', () => {
    expect(tableCaution(1)).toBe(
      'This rests on 1 linked video. A handful of videos proves little: one topic, one week or one thumbnail can explain a difference, so read this as a record, not a rule.',
    );
    expect(tableCaution(4)).toContain('This rests on 4 linked videos.');
  });
});

describe('the plan API', () => {
  const plan: PlanView = { centerChannelId: CHANNEL, linked: [], table: [], linkable: [] };
  const recording = (data: unknown, status = 200) => {
    const sent: string[] = [];
    const api = createExtrasApi(async (url, init) => {
      sent.push(`${init?.method ?? 'GET'} ${String(url)} ${String(init?.body ?? '')}`.trim());
      return new Response(
        JSON.stringify({ success: status < 400, data, error: status < 400 ? null : 'Refused' }),
        { status },
      );
    });
    return { api, sent };
  };

  test('reads, links and unlinks', async () => {
    const { api, sent } = recording(plan);
    await expect(api.plan(CHANNEL)).resolves.toEqual(plan);
    await expect(api.linkPlanVideo(CHANNEL, 3, 'https://youtu.be/abcdefghijk')).resolves.toEqual(
      plan,
    );
    await expect(api.unlinkPlanVideo(CHANNEL, 3)).resolves.toEqual(plan);
    expect(sent).toEqual([
      `GET /api/plan?channel=${CHANNEL}`,
      `POST /api/plan/link {"channel":"${CHANNEL}","conceptId":3,"link":"https://youtu.be/abcdefghijk"}`,
      `POST /api/plan/unlink {"channel":"${CHANNEL}","conceptId":3}`,
    ]);
    await expect(recording(null, 404).api.plan(CHANNEL)).resolves.toBeNull();
    await expect(recording(null, 409).api.linkPlanVideo(CHANNEL, 3, 'x')).rejects.toThrow(
      'Refused',
    );
  });
});
