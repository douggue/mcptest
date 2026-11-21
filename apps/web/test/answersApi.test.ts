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
