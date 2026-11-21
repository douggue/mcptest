import { describe, expect, test } from 'vitest';
import { createAnswersApi } from '../src/lib/answersApi';

const CHANNEL = 'UCaaaaaaaaaaaaaaaaaaaaaa';
const OTHER = 'UCbbbbbbbbbbbbbbbbbbbbbb';
const VIDEO = {
  videoId: 'aaaaaaaaaa1',
  title: 'T',
  channelId: CHANNEL,
  channelTitle: 'A',
  views: 5,
};

function replying(data: unknown, asked: string[] = []) {
  return createAnswersApi(async (url) => {
    asked.push(String(url));
    return new Response(JSON.stringify({ success: true, data, error: null }));
  });
}

describe('the kept answer of a channel', () => {
  test('is read with its prompt, its videos and when it was written', async () => {
    const asked: string[] = [];
    const api = replying(
      {
        answer: {
          analysis: 'thumbnails',
          channelId: CHANNEL,
          text: 'Review',
          prompt: 'P',
          videos: [VIDEO],
          engine: 'claude',
          writtenAt: '2026-11-20T12:00:00.000Z',
        },
      },
      asked,
    );

    expect(await api.keptAnswer('thumbnails', CHANNEL)).toEqual({
      text: 'Review',
      engine: 'claude',
      skipped: [],
      prompt: 'P',
      videos: [VIDEO],
      writtenAt: '2026-11-20T12:00:00.000Z',
    });
    expect(asked).toEqual([`/api/analyses?channel=${CHANNEL}&analysis=thumbnails`]);
  });

  test('is null when the channel has none', async () => {
    expect(await replying({ answer: null }).keptAnswer('topics', CHANNEL)).toBeNull();
  });
});

describe('the videos an answer names', () => {
  test('are asked for by id, with the studied channel when there is one', async () => {
    const asked: string[] = [];
    const api = replying({ videos: [VIDEO] }, asked);

    expect(await api.namedVideos(CHANNEL, ['aaaaaaaaaa1', 'bbbbbbbbbb2'], OTHER)).toEqual([VIDEO]);
    expect(asked).toEqual([
      `/api/videos/named?channel=${CHANNEL}&ids=aaaaaaaaaa1%2Cbbbbbbbbbb2&of=${OTHER}`,
    ]);
  });

  test('are none, with no request, when no id is named', async () => {
    const asked: string[] = [];

    expect(await replying({ videos: [] }, asked).namedVideos(CHANNEL, [])).toEqual([]);
    expect(asked).toEqual([]);
  });
});

describe('the flow counts and the style lock', () => {
  test('read the counts of the channel, and none for one with no map', async () => {
    const asked: string[] = [];
    const counts = { breakouts: 1 };

    expect(await replying(counts, asked).flow(CHANNEL)).toEqual(counts);
    expect(asked).toEqual([`/api/flow?channel=${CHANNEL}`]);
    const none = createAnswersApi(
      async () =>
        new Response(JSON.stringify({ success: false, data: null, error: 'No map' }), {
          status: 404,
        }),
    );
    expect(await none.flow(CHANNEL)).toBeNull();
  });

  test('read, take and stop the style lock of the channel', async () => {
    const sent: string[] = [];
    const lock = { channelId: CHANNEL, from: null, text: 'STYLE', writtenAt: 'x' };
    const api = createAnswersApi(async (url, init) => {
      sent.push(`${init?.method ?? 'GET'} ${String(url)} ${String(init?.body ?? '')}`.trim());
      return new Response(JSON.stringify({ success: true, data: { lock }, error: null }));
    });

    expect(await api.styleLock(CHANNEL)).toEqual(lock);
    expect(await api.useStyleLock(CHANNEL, OTHER)).toEqual(lock);
    await api.stopStyleLock(CHANNEL);

    expect(sent).toEqual([
      `GET /api/style-lock?channel=${CHANNEL}`,
      `POST /api/style-lock {"channel":"${CHANNEL}","from":"${OTHER}"}`,
      `POST /api/style-lock/stop {"channel":"${CHANNEL}"}`,
    ]);
  });
});
