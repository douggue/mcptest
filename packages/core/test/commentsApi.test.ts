import { describe, expect, test } from 'vitest';
import {
  COMMENTS_PER_VIDEO,
  COMMENT_UNITS_PER_VIDEO,
  MAX_COMMENT_CHARS,
  fetchTopComments,
} from '../src/sources/commentsApi';

const KEY = 'stand-in-key-for-tests';
const VIDEO = 'abcdefghijk';

/** One thread as commentThreads.list documents it. */
const thread = (id: string, text: string, likes = 3) => ({
  kind: 'youtube#commentThread',
  id,
  snippet: {
    videoId: VIDEO,
    topLevelComment: {
      kind: 'youtube#comment',
      id,
      snippet: {
        textOriginal: text,
        textDisplay: text,
        authorDisplayName: '@someone',
        likeCount: likes,
        publishedAt: '2026-11-20T10:00:00Z',
      },
    },
    totalReplyCount: 0,
  },
});

const recording = (status: number, body: unknown) => {
  const asked: { url: string; headers: Record<string, string> }[] = [];
  const fetcher: typeof fetch = async (url, init) => {
    asked.push({ url: String(url), headers: (init?.headers ?? {}) as Record<string, string> });
    return new Response(JSON.stringify(body), { status });
  };
  return { asked, fetcher };
};

describe('fetchTopComments', () => {
  test('reads one page of top-level comments, most relevant first, at a stated cost', async () => {
    const { asked, fetcher } = recording(200, {
      items: [thread('Ugx1', 'Please make one on bridges'), thread('Ugx2', 'x'.repeat(5000), 9)],
    });

    const result = await fetchTopComments(VIDEO, { apiKey: KEY, fetch: fetcher });

    expect(COMMENTS_PER_VIDEO).toBe(100);
    expect(COMMENT_UNITS_PER_VIDEO).toBe(1);
    expect(result.status).toBe('read');
    expect(result.comments).toEqual([
      {
        commentId: 'Ugx1',
        videoId: VIDEO,
        text: 'Please make one on bridges',
        likes: 3,
        publishedAt: new Date('2026-11-20T10:00:00Z'),
      },
      expect.objectContaining({ commentId: 'Ugx2', likes: 9 }),
    ]);
    expect(result.comments[1]?.text).toHaveLength(MAX_COMMENT_CHARS);
    const [request] = asked;
    expect(request?.url).toContain('/commentThreads?');
    expect(request?.url).toContain(`videoId=${VIDEO}`);
    expect(request?.url).toContain('order=relevance');
    expect(request?.url).toContain('maxResults=100');
    expect(request?.url).not.toContain(KEY);
    expect(request?.headers['x-goog-api-key']).toBe(KEY);
  });

  test('says so when the video has its comments turned off', async () => {
    const { fetcher } = recording(403, {
      error: { message: 'disabled', errors: [{ reason: 'commentsDisabled' }] },
    });

    await expect(fetchTopComments(VIDEO, { apiKey: KEY, fetch: fetcher })).resolves.toEqual({
      status: 'disabled',
      comments: [],
    });
  });

  test('passes on any other refusal with the key taken out of it', async () => {
    const { fetcher } = recording(400, { error: { message: `bad key ${KEY}` } });

    const failed = fetchTopComments(VIDEO, { apiKey: KEY, fetch: fetcher });

    await expect(failed).rejects.toThrow(
      'The YouTube API refused the request (400): bad key [key]',
    );
  });

  test('refuses without a key or with a video id that is not one, before any request', async () => {
    const { asked, fetcher } = recording(200, { items: [] });

    await expect(fetchTopComments(VIDEO, { apiKey: ' ', fetch: fetcher })).rejects.toThrow(
      'No YouTube API key is set',
    );
    await expect(fetchTopComments('no', { apiKey: KEY, fetch: fetcher })).rejects.toThrow(
      'Not a valid YouTube video id',
    );
    expect(asked).toEqual([]);
  });

  test('leaves out an entry that cannot be read', async () => {
    const { fetcher } = recording(200, { items: [{ id: 'broken' }, thread('Ugx3', 'ok')] });

    const result = await fetchTopComments(VIDEO, { apiKey: KEY, fetch: fetcher });

    expect(result.comments.map((comment) => comment.commentId)).toEqual(['Ugx3']);
  });
});
