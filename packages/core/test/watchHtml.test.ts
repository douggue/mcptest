import { describe, expect, test } from 'vitest';
import { InnertubeSource, type FetchText, type InnertubeClient } from '../src/sources/innertube';
import { RateLimiter } from '../src/sources/limiter';
import { MAX_WATCH_PAGE_BYTES } from '../src/sources/watchHtml';

const NOW = new Date('2026-11-21T12:00:00Z');
const limiter = new RateLimiter({
  concurrency: 1,
  minDelayMs: 0,
  maxDelayMs: 0,
  maxRetries: 0,
  baseBackoffMs: 0,
  sleep: async () => {},
});
const client = {} as InnertubeClient;

function sourceAnswering(answer: () => Response) {
  const asked: Array<{ url: string; language: string | undefined; redirect: string }> = [];
  const fetchText: FetchText = async (url, init) => {
    asked.push({ url, language: init.headers?.['accept-language'], redirect: init.redirect });
    return answer();
  };
  return { asked, source: new InnertubeSource(client, limiter, () => NOW, fetchText) };
}

describe('InnertubeSource.fetchWatchHtml', () => {
  test('asks for the watch page in English once, refusing redirects', async () => {
    const { asked, source } = sourceAnswering(() => new Response('<html>page</html>'));
    await expect(source.fetchWatchHtml('abcdefghijk')).resolves.toBe('<html>page</html>');
    expect(asked).toEqual([
      {
        url: 'https://www.youtube.com/watch?v=abcdefghijk&hl=en',
        language: 'en',
        redirect: 'error',
      },
    ]);
  });

  test('refuses a video id that is not one, before any request', async () => {
    const { asked, source } = sourceAnswering(() => new Response(''));
    await expect(source.fetchWatchHtml('../x')).rejects.toThrow(/Not a valid YouTube video id/);
    expect(asked).toEqual([]);
  });

  test('a refusal carries its status', async () => {
    const { source } = sourceAnswering(() => new Response('', { status: 429 }));
    await expect(source.fetchWatchHtml('abcdefghijk')).rejects.toMatchObject({
      status: 429,
      message: expect.stringMatching(/status 429/),
    });
  });

  test('a page larger than the cap is not read', async () => {
    const big = new Uint8Array(MAX_WATCH_PAGE_BYTES + 1);
    const { source } = sourceAnswering(() => new Response(big));
    await expect(source.fetchWatchHtml('abcdefghijk')).rejects.toThrow(/too large/);
  });
});
