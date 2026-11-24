import { afterEach, describe, expect, test } from 'vitest';
import { makeYouTubeFetch } from '../src/sources/youtubeFetch';
import {
  closedPort,
  startHttpProxy,
  startSocks5Proxy,
  startTarget,
  type LocalServer,
} from './localProxies';

const running: LocalServer[] = [];
const started = async (server: Promise<LocalServer>): Promise<LocalServer> => {
  const ready = await server;
  running.push(ready);
  return ready;
};

afterEach(async () => {
  await Promise.all(running.splice(0).map((server) => server.close()));
});

const OPTIONS = { signal: AbortSignal.timeout(5000) } as const;

describe('Jgtube’s one way to reach YouTube', () => {
  test('goes straight to the address when no proxy is set', async () => {
    const target = await started(startTarget());
    const proxy = await started(startHttpProxy());
    const fetcher = makeYouTubeFetch(() => null);
    const answer = await fetcher(`http://127.0.0.1:${target.port}/direct`, OPTIONS);
    expect(await answer.text()).toBe('hello from the target');
    expect(proxy.seen).toEqual([]);
    expect(target.seen).toEqual(['/direct']);
  });

  test('goes through an HTTP proxy when one is set', async () => {
    const target = await started(startTarget());
    const proxy = await started(startHttpProxy());
    const fetcher = makeYouTubeFetch(() => `http://127.0.0.1:${proxy.port}`);
    const answer = await fetcher(`http://127.0.0.1:${target.port}/via-http`, OPTIONS);
    expect(answer.status).toBe(200);
    expect(await answer.text()).toBe('hello from the target');
    expect(proxy.seen).toEqual([`127.0.0.1:${target.port}`]);
  });

  test('gives the HTTP proxy the user name and password written in its address', async () => {
    const target = await started(startTarget());
    const proxy = await started(startHttpProxy('owner:s3cret'));
    const fetcher = makeYouTubeFetch(() => `http://owner:s3cret@127.0.0.1:${proxy.port}`);
    const answer = await fetcher(`http://127.0.0.1:${target.port}/`, OPTIONS);
    expect(await answer.text()).toBe('hello from the target');
  });

  test('goes through a SOCKS5 proxy with a user name and password', async () => {
    const target = await started(startTarget());
    const proxy = await started(startSocks5Proxy('owner:s3cret'));
    const fetcher = makeYouTubeFetch(() => `socks5://owner:s3cret@127.0.0.1:${proxy.port}`);
    const answer = await fetcher(`http://127.0.0.1:${target.port}/via-socks`, OPTIONS);
    expect(await answer.text()).toBe('hello from the target');
    expect(proxy.seen).toEqual([`127.0.0.1:${target.port}`]);
    expect(target.seen).toEqual(['/via-socks']);
  });

  test('takes a request object, as the YouTube library passes one', async () => {
    const target = await started(startTarget());
    const proxy = await started(startHttpProxy());
    const fetcher = makeYouTubeFetch(() => `http://127.0.0.1:${proxy.port}`);
    const request = new Request(`http://127.0.0.1:${target.port}/as-request?x=1`, {
      method: 'POST',
      body: '{"a":1}',
      headers: { 'content-type': 'application/json' },
    });
    const answer = await fetcher(request, { body: '{"a":1}', headers: request.headers });
    expect(await answer.text()).toBe('hello from the target');
    expect(target.seen).toEqual(['/as-request?x=1']);
    expect(proxy.seen).toHaveLength(1);
  });

  test('uses a proxy saved while Jgtube runs from the next request on', async () => {
    const target = await started(startTarget());
    const first = await started(startHttpProxy());
    const second = await started(startSocks5Proxy());
    let setting: string | null = null;
    const fetcher = makeYouTubeFetch(() => setting);
    const url = `http://127.0.0.1:${target.port}/`;
    await (await fetcher(url, OPTIONS)).text();
    setting = `http://127.0.0.1:${first.port}`;
    await (await fetcher(url, OPTIONS)).text();
    setting = `socks5://127.0.0.1:${second.port}`;
    await (await fetcher(url, OPTIONS)).text();
    setting = null;
    await (await fetcher(url, OPTIONS)).text();
    expect(first.seen).toHaveLength(1);
    expect(second.seen).toHaveLength(1);
    expect(target.seen).toHaveLength(4);
  });

  test('fails, and never goes direct, when the proxy cannot be reached', async () => {
    const target = await started(startTarget());
    const port = await closedPort();
    const fetcher = makeYouTubeFetch(() => `http://owner:hunter2@127.0.0.1:${port}`);
    const failure = await fetcher(`http://127.0.0.1:${target.port}/`, OPTIONS).then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(Error);
    expect(String((failure as Error).message)).toMatch(/through the proxy for YouTube/);
    expect(String((failure as Error).message)).not.toContain('hunter2');
    expect(JSON.stringify(failure)).not.toContain('hunter2');
    expect(target.seen).toEqual([]);
  });

  test('fails when the proxy refuses the password, without repeating it', async () => {
    const target = await started(startTarget());
    const proxy = await started(startSocks5Proxy('owner:right'));
    const fetcher = makeYouTubeFetch(() => `socks5://owner:wrong-hunter2@127.0.0.1:${proxy.port}`);
    const failure = await fetcher(`http://127.0.0.1:${target.port}/`, OPTIONS).then(
      () => null,
      (error: unknown) => error as Error,
    );
    expect(failure?.message).toMatch(/through the proxy for YouTube/);
    expect(failure?.message).not.toContain('wrong-hunter2');
    expect(target.seen).toEqual([]);
  });

  test('fails, and never goes direct, when the setting read is not valid', async () => {
    const target = await started(startTarget());
    const fetcher = makeYouTubeFetch(() => {
      throw new Error('The Proxy for YouTube setting is not valid');
    });
    await expect(fetcher(`http://127.0.0.1:${target.port}/`, OPTIONS)).rejects.toThrow(/not valid/);
    expect(target.seen).toEqual([]);
  });
});
