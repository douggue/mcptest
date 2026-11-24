import { afterEach, describe, expect, test } from 'vitest';
import {
  PROXY_CHECK_PAGE,
  checkYouTubeProxy,
  type ProxyCheckFetch,
} from '../src/sources/youtubeProxyCheck';
import { closedPort, startHttpProxy, startTarget, type LocalServer } from './localProxies';

const PROXY = 'http://owner:hunter2@proxy.example.com:3128';

const answering =
  (response: Response): ProxyCheckFetch =>
  async () =>
    response;

const failing =
  (error: unknown): ProxyCheckFetch =>
  async () => {
    throw error;
  };

/** An error as undici gives it: "fetch failed", with the real reason as its cause. */
const networkError = (cause: object): Error =>
  Object.assign(new TypeError('fetch failed'), { cause });

const PLAYABLE_PAGE =
  '<html><script>var ytInitialPlayerResponse = {"playabilityStatus":{"status":"OK"}};</script></html>';
const BOT_PAGE =
  '<html><script>var ytInitialPlayerResponse = {"playabilityStatus":{"status":"LOGIN_REQUIRED","reason":"Sign in to confirm you’re not a bot"}};</script></html>';

describe('testing the proxy for YouTube', () => {
  test('reads one public video page', () => {
    expect(PROXY_CHECK_PAGE).toMatch(/^https:\/\/www\.youtube\.com\/watch\?v=[\w-]{11}$/);
  });

  test('says reachable when YouTube shows the page', async () => {
    const result = await checkYouTubeProxy(PROXY, answering(new Response(PLAYABLE_PAGE)));
    expect(result).toEqual({
      verdict: 'reachable',
      reason: 'YouTube answered through the proxy with a public video page.',
    });
  });

  test('says sign-in asked when YouTube wants to confirm this is not a bot', async () => {
    const result = await checkYouTubeProxy(PROXY, answering(new Response(BOT_PAGE)));
    expect(result.verdict).toBe('sign-in');
    expect(result.reason).toMatch(/sign in to confirm .* not a bot/i);
  });

  test('says sign-in asked when YouTube sends the page to a sign-in or consent page', async () => {
    for (const location of [
      'https://consent.youtube.com/m?continue=x',
      'https://accounts.google.com/ServiceLogin',
    ]) {
      const result = await checkYouTubeProxy(
        PROXY,
        answering(new Response(null, { status: 302, headers: { location } })),
      );
      expect(result.verdict).toBe('sign-in');
    }
  });

  test('says refused when YouTube turns the address away', async () => {
    for (const status of [403, 429]) {
      const result = await checkYouTubeProxy(PROXY, answering(new Response('', { status })));
      expect(result).toEqual({
        verdict: 'refused',
        reason: `YouTube turned this address away (status ${status}).`,
      });
    }
  });

  test.each([
    [{ code: 'ECONNREFUSED' }, 'Nothing answered at the proxy’s address and port.'],
    [{ code: 'ENOTFOUND' }, 'The proxy’s host name was not found.'],
    [{ code: 'ETIMEDOUT' }, 'The proxy did not answer in time.'],
    [
      { message: 'Proxy response (407) !== 200 when HTTP Tunneling' },
      'The proxy asked for a user name and password, or did not accept the ones given.',
    ],
    [
      { message: 'SOCKS5 authentication failed' },
      'The proxy asked for a user name and password, or did not accept the ones given.',
    ],
  ])('says refused, with the plain reason, when the proxy fails (%o)', async (cause, reason) => {
    const result = await checkYouTubeProxy(PROXY, failing(networkError(cause)));
    expect(result).toEqual({ verdict: 'refused', reason });
  });

  test('says no answer came in time when the page takes too long', async () => {
    const timeout = Object.assign(new Error('The operation was aborted due to timeout'), {
      name: 'TimeoutError',
    });
    const result = await checkYouTubeProxy(PROXY, failing(timeout));
    expect(result).toEqual({ verdict: 'refused', reason: 'No answer came within 15 seconds.' });
  });

  test('never repeats the password, whatever the failure says', async () => {
    const result = await checkYouTubeProxy(
      PROXY,
      failing(networkError({ message: `cannot reach ${PROXY} as owner:hunter2` })),
    );
    expect(result.verdict).toBe('refused');
    expect(result.reason).not.toContain('hunter2');
  });

  test('says other statuses plainly', async () => {
    const result = await checkYouTubeProxy(PROXY, answering(new Response('', { status: 502 })));
    expect(result).toEqual({
      verdict: 'refused',
      reason: 'The proxy or YouTube answered with status 502.',
    });
  });
});

describe('testing through a real proxy on this computer', () => {
  const running: LocalServer[] = [];
  afterEach(async () => {
    await Promise.all(running.splice(0).map((server) => server.close()));
  });

  test('reaches the page through the proxy', async () => {
    const target = await startTarget(PLAYABLE_PAGE);
    const proxy = await startHttpProxy();
    running.push(target, proxy);
    const result = await checkYouTubeProxy(
      `http://127.0.0.1:${proxy.port}`,
      undefined,
      `http://127.0.0.1:${target.port}/watch?v=jNQXAC9IVRw`,
    );
    expect(result.verdict).toBe('reachable');
    expect(proxy.seen).toEqual([`127.0.0.1:${target.port}`]);
  });

  test('says refused when nothing listens at the proxy’s port', async () => {
    const port = await closedPort();
    const result = await checkYouTubeProxy(
      `http://127.0.0.1:${port}`,
      undefined,
      'http://127.0.0.1:65000/watch?v=jNQXAC9IVRw',
    );
    expect(result).toEqual({
      verdict: 'refused',
      reason: 'Nothing answered at the proxy’s address and port.',
    });
  });
});
