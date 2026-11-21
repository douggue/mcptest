import { describe, expect, test } from 'vitest';
import {
  FINDING_LABELS,
  askedLine,
  quotaLine,
  readLine,
  readOutcomeLine,
  type CommentsView,
} from '../src/lib/comments';
import { createExtrasApi } from '../src/lib/extrasApi';

const CHANNEL = 'UCHnyfMqiRRG1u-2MsSQLbXA';
const NOW = new Date('2026-11-21T12:00:00Z');
const view: CommentsView = {
  centerChannelId: CHANNEL,
  keySet: true,
  unitsPerVideo: 1,
  maxVideos: 10,
  dailyUnits: 10_000,
  candidates: [],
  answer: null,
};

describe('the comment mining wording', () => {
  test('states the quota before reading', () => {
    expect(quotaLine(view, 3)).toBe(
      'Reading 3 videos uses 3 units of your YouTube API key’s daily allowance (10,000 units a day by default). At most 10 videos at once.',
    );
    expect(quotaLine(view, 1)).toContain('Reading 1 video uses 1 unit');
  });

  test('says what is known of a video’s comments', () => {
    expect(readLine(null, NOW)).toBe('Comments not read yet');
    expect(readLine({ status: 'read', count: 80, readAt: '2026-11-21T09:00:00Z' }, NOW)).toBe(
      '80 comments read 3 hours ago',
    );
    expect(readLine({ status: 'disabled', count: 0, readAt: '2026-11-21T09:00:00Z' }, NOW)).toBe(
      'Comments are turned off for this video',
    );
  });

  test('sums up how a read went', () => {
    expect(
      readOutcomeLine([
        { videoId: 'a', status: 'read', count: 80, problem: null },
        { videoId: 'b', status: 'disabled', count: 0, problem: null },
        { videoId: 'c', status: 'failed', count: 0, problem: 'Refused' },
        { videoId: 'd', status: 'skipped', count: 0, problem: null },
      ]),
    ).toBe(
      'Read 80 comments from 1 video. 1 had comments turned off. 1 could not be read: Refused. 1 was not tried: the key’s daily allowance ran out.',
    );
  });

  test('names each kind of finding and says what an answer rests on', () => {
    expect(FINDING_LABELS).toEqual({
      request: 'Request',
      question: 'Question',
      objection: 'Objection',
    });
    expect(
      askedLine(
        { videoIds: ['a', 'b'], findings: [], engine: 'claude', askedAt: '2026-11-21T10:00:00Z' },
        NOW,
      ),
    ).toBe(
      'From the stored comments of 2 videos, 2 hours ago, by claude. Only findings resting on two or more of the comments handed out are kept.',
    );
  });
});

describe('the comments API', () => {
  test('reads, starts a read and a question, and reads a job', async () => {
    const sent: string[] = [];
    const api = createExtrasApi(async (url, init) => {
      sent.push(`${init?.method ?? 'GET'} ${String(url)} ${String(init?.body ?? '')}`.trim());
      return new Response(JSON.stringify({ success: true, data: { jobId: 'j1' }, error: null }), {
        status: 200,
      });
    });

    await api.comments(CHANNEL);
    await expect(api.readComments(CHANNEL, ['abcdefghijk'])).resolves.toBe('j1');
    await expect(api.askViewers(CHANNEL, ['abcdefghijk'])).resolves.toBe('j1');
    await api.extrasJob('j1');
    expect(sent).toEqual([
      `GET /api/comments?channel=${CHANNEL}`,
      `POST /api/comments/read {"channel":"${CHANNEL}","videoIds":["abcdefghijk"]}`,
      `POST /api/comments/ask {"channel":"${CHANNEL}","videoIds":["abcdefghijk"]}`,
      'GET /api/extras/job?id=j1',
    ]);
  });
});
