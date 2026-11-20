import { describe, expect, test } from 'vitest';
import {
  FEED_MAX_BYTES,
  FEED_TIMEOUT_MS,
  channelFeedUrl,
  decodeXml,
  fetchFeed,
  parseFeed,
  shortsFeedUrl,
} from '../src/youtube/feed';
import { channelId, videoId } from './fixtures/apiReplies';
import { feedEntry, feedXml } from './fixtures/feeds';

interface Seen {
  url: string;
  init: RequestInit | undefined;
}

/** A network that answers every request the same way and notes what it was asked. */
function network(answer: () => Response | Promise<Response>): {
  fetch: typeof fetch;
  seen: Seen[];
} {
  const seen: Seen[] = [];
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(input), init });
    return answer();
  }) as typeof fetch;
  return { fetch: fetcher, seen };
}

const URL_A = shortsFeedUrl(channelId('A'));

describe('the feed addresses', () => {
  test('point at a channel’s uploads and at its Shorts-only list', () => {
    expect(channelFeedUrl(channelId('A'))).toBe(
      `https://www.youtube.com/feeds/videos.xml?channel_id=UC${'A'.repeat(22)}`,
    );
    expect(URL_A).toBe(
      `https://www.youtube.com/feeds/videos.xml?playlist_id=UUSH${'A'.repeat(22)}`,
    );
  });
});

describe('decodeXml', () => {
  test('reads named and numbered character codes and leaves anything else as written', () => {
    expect(decodeXml('Salt &amp; pepper &lt;3 &quot;quick&quot; &apos;easy&apos; &gt;')).toBe(
      'Salt & pepper <3 "quick" \'easy\' >',
    );
    expect(decodeXml('It&#39;s 5&#x27; long &#128690;')).toBe("It's 5' long \u{1F6B2}");
    expect(decodeXml('&nbsp; &#0; &#x110000; &#99999999999; 5 & 6')).toBe(
      '&nbsp; &#0; &#x110000; &#99999999999; 5 & 6',
    );
  });
});

describe('parseFeed', () => {
  test('reads each entry: ids, title, moment of publication, views and the kind of link', () => {
    const xml = feedXml('A', [
      feedEntry(1, 'A', { views: 2500, published: '2026-11-20T18:30:00+00:00' }),
      feedEntry(2, 'A', { link: 'watch', views: 40 }),
    ]);

    const feed = parseFeed(xml);

    expect(feed?.skipped).toBe(0);
    expect(feed?.entries).toEqual([
      {
        videoId: videoId(1),
        channelId: channelId('A'),
        title: 'Three-ingredient flatbread and a hot pan',
        publishedAt: new Date('2026-11-20T18:30:00Z'),
        views: 2500,
        shortsLink: true,
      },
      {
        videoId: videoId(2),
        channelId: channelId('A'),
        title: 'Why the moon looks bigger at the horizon',
        publishedAt: new Date('2026-11-20T18:00:00Z'),
        views: 40,
        shortsLink: false,
      },
    ]);
  });

  test('reads a title written with character codes and one written as CDATA', () => {
    const xml = feedXml('B', [
      feedEntry(1, 'B', { title: 'Bread &amp; butter in 30&#39;&#39; &lt;no oven&gt;' }),
      feedEntry(2, 'B', { title: '<![CDATA[Why <b>Mars</b> & the moon look red]]>' }),
      feedEntry(3, 'B', { title: 'A wren, <![CDATA[a robin & a tit]]> &amp; a boot' }),
    ]);

    const titles = parseFeed(xml)?.entries.map((entry) => entry.title);

    expect(titles).toEqual([
      "Bread & butter in 30'' <no oven>",
      'Why <b>Mars</b> & the moon look red',
      'A wren, a robin & a tit & a boot',
    ]);
  });

  test('gives no entries for a feed that has none', () => {
    expect(parseFeed(feedXml('C', []))).toEqual({ entries: [], skipped: 0 });
  });

  test.each([
    ['a page of HTML', '<!doctype html><html><body>Before you continue</body></html>'],
    ['a document cut short', feedXml('A', [feedEntry(1, 'A')]).slice(0, 400)],
    ['nothing', ''],
    ['JSON', '{"items":[]}'],
  ])('says %s is not a feed', (_what, text) => {
    expect(parseFeed(text)).toBeNull();
  });

  test('leaves out and counts an entry whose ids or date are not what they should be', () => {
    const xml = feedXml('A', [
      feedEntry(1, 'A', { rawVideoId: 'short' }),
      feedEntry(2, 'A', { rawVideoId: `${videoId(2)}"/><script>` }),
      feedEntry(3, 'A', { published: 'yesterday' }),
      feedEntry(4, 'A').replace(/<yt:channelId>.*<\/yt:channelId>/, ''),
      feedEntry(5, 'A'),
    ]);

    const feed = parseFeed(xml);

    expect(feed?.entries.map((entry) => entry.videoId)).toEqual([videoId(5)]);
    expect(feed?.skipped).toBe(4);
  });

  test('keeps an entry with no view count, an unreadable one or no link, saying so', () => {
    const xml = feedXml('A', [
      feedEntry(1, 'A', { views: null }),
      feedEntry(2, 'A').replace(/views="\d+"/, 'views="many"'),
      feedEntry(3, 'A', { link: 'none' }),
    ]);

    const entries = parseFeed(xml)?.entries;

    expect(entries?.map((entry) => entry.views)).toEqual([null, null, 3000]);
    expect(entries?.map((entry) => entry.shortsLink)).toEqual([true, true, null]);
  });

  test('cuts a very long title to length', () => {
    const xml = feedXml('A', [feedEntry(1, 'A', { title: 'x'.repeat(5000) })]);

    expect(parseFeed(xml)?.entries[0]?.title).toHaveLength(300);
  });
});

describe('fetchFeed', () => {
  test('fetches the feed without following redirects and gives its entries and validators', async () => {
    const xml = feedXml('A', [feedEntry(1, 'A')]);
    const net = network(
      () =>
        new Response(xml, {
          headers: { etag: '"abc"', 'last-modified': 'Fri, 20 Nov 2026 19:00:00 GMT' },
        }),
    );

    const result = await fetchFeed(URL_A, { fetch: net.fetch });

    expect(result).toMatchObject({
      kind: 'ok',
      skipped: 0,
      validators: { etag: '"abc"', lastModified: 'Fri, 20 Nov 2026 19:00:00 GMT' },
    });
    expect(result.kind === 'ok' && result.entries.map((entry) => entry.videoId)).toEqual([
      videoId(1),
    ]);
    expect(net.seen[0]?.url).toBe(URL_A);
    expect(net.seen[0]?.init).toMatchObject({ redirect: 'error', headers: {} });
    expect(net.seen[0]?.init?.signal).toBeInstanceOf(AbortSignal);
    expect(FEED_TIMEOUT_MS).toBe(15_000);
  });

  test('has no validators when the reply gave none', async () => {
    const net = network(() => new Response(feedXml('A', [])));

    const result = await fetchFeed(URL_A, { fetch: net.fetch });

    expect(result).toEqual({
      kind: 'ok',
      entries: [],
      skipped: 0,
      validators: { etag: null, lastModified: null },
    });
  });

  test('sends back only the validators it was given, and takes "not changed" for an answer', async () => {
    const net = network(() => new Response(null, { status: 304 }));

    const both = await fetchFeed(URL_A, {
      fetch: net.fetch,
      validators: { etag: '"abc"', lastModified: 'Fri, 20 Nov 2026 19:00:00 GMT' },
    });
    await fetchFeed(URL_A, { fetch: net.fetch, validators: { etag: null, lastModified: null } });

    expect(both).toEqual({ kind: 'not_modified' });
    expect(net.seen[0]?.init?.headers).toEqual({
      'if-none-match': '"abc"',
      'if-modified-since': 'Fri, 20 Nov 2026 19:00:00 GMT',
    });
    expect(net.seen[1]?.init?.headers).toEqual({});
  });

  test('says "not found" for a feed YouTube does not have', async () => {
    const net = network(() => new Response('Not Found', { status: 404 }));

    expect(await fetchFeed(URL_A, { fetch: net.fetch })).toEqual({ kind: 'not_found' });
  });

  test.each([500, 503, 429, 403])('reports a refusal with status %s as failed', async (status) => {
    const net = network(() => new Response('', { status }));

    expect(await fetchFeed(URL_A, { fetch: net.fetch })).toEqual({
      kind: 'failed',
      message: `YouTube refused the feed (${status})`,
    });
  });

  test('reports what is not a feed as failed, not as an empty feed', async () => {
    const net = network(() => new Response('<html><body>Sign in</body></html>'));

    expect(await fetchFeed(URL_A, { fetch: net.fetch })).toEqual({
      kind: 'failed',
      message: 'What YouTube sent was not a feed',
    });
  });

  test('stops reading a document larger than a feed should be', async () => {
    const huge = feedXml('A', [feedEntry(1, 'A', { title: 'x'.repeat(FEED_MAX_BYTES) })]);
    const net = network(() => new Response(huge));

    expect(await fetchFeed(URL_A, { fetch: net.fetch })).toEqual({
      kind: 'failed',
      message: 'The feed was larger than a feed should be',
    });
    expect(FEED_MAX_BYTES).toBe(512 * 1024);
  });

  test('reads a reply with no body as not a feed', async () => {
    const net = network(() => new Response(null, { status: 200 }));

    expect(await fetchFeed(URL_A, { fetch: net.fetch })).toMatchObject({ kind: 'failed' });
  });

  test('reports a network fault, a redirect and a timeout in words, without throwing', async () => {
    const down = network(() => {
      throw new TypeError('fetch failed');
    });
    const slow = network(() => {
      throw Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    });
    const odd = network(() => {
      throw 'a string';
    });

    expect(await fetchFeed(URL_A, { fetch: down.fetch })).toEqual({
      kind: 'failed',
      message: 'The feed could not be read: fetch failed',
    });
    expect(await fetchFeed(URL_A, { fetch: slow.fetch })).toEqual({
      kind: 'failed',
      message: 'YouTube did not send the feed within 15 seconds',
    });
    expect(await fetchFeed(URL_A, { fetch: odd.fetch })).toMatchObject({ kind: 'failed' });
  });

  test('passes on a stop signal, so a fetch under way ends when the service stops', async () => {
    const halt = new AbortController();
    const net = network(() => new Response(feedXml('A', [])));

    await fetchFeed(URL_A, { fetch: net.fetch, signal: halt.signal });
    halt.abort();

    expect(net.seen[0]?.init?.signal?.aborted).toBe(true);
  });
});
