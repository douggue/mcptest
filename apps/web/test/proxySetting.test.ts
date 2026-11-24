import { describe, expect, test } from 'vitest';
import {
  PROXY_SETTING,
  createSettingsApi,
  placeholderOf,
  proxyTestTitle,
  type SettingView,
} from '../src/lib/settings';

const reply = (data: unknown) =>
  new Response(JSON.stringify({ success: true, data, error: null, meta: null }), { status: 200 });

const proxy = (set: boolean): SettingView => ({
  name: PROXY_SETTING,
  label: 'Proxy for YouTube',
  help: 'Sends Jgtube’s YouTube reading and downloads through this address.',
  secret: true,
  effect: 'now',
  set,
  value: null,
  outside: false,
});

describe('the proxy for YouTube on the settings screen', () => {
  test('is named as the server names it', () => {
    expect(PROXY_SETTING).toBe('JGTUBE_YOUTUBE_PROXY');
  });

  test('shows the shape of an address to paste, not a key', () => {
    expect(placeholderOf(proxy(false))).toBe(
      'http://host:port or socks5://user:password@host:port',
    );
    expect(placeholderOf(proxy(true))).toBe('Paste a new address to replace it');
  });

  test('keys keep their own words', () => {
    const key = { ...proxy(true), name: 'YOUTUBE_API_KEY' };
    expect(placeholderOf(key)).toBe('Paste a new key to replace it');
    expect(placeholderOf({ ...key, set: false })).toBe('Paste the key');
    expect(placeholderOf({ ...key, secret: false })).toBe('');
  });

  test('says each verdict of the Test in a word', () => {
    expect(proxyTestTitle('reachable')).toBe('Reachable');
    expect(proxyTestTitle('refused')).toBe('Refused');
    expect(proxyTestTitle('sign-in')).toBe('Sign-in asked');
    expect(proxyTestTitle('not-set')).toBe('Not set');
  });

  test('asks the server to test the saved proxy with a POST', async () => {
    const calls: Array<readonly [string, RequestInit | undefined]> = [];
    const api = createSettingsApi(async (url, init) => {
      calls.push([String(url), init]);
      return reply({ verdict: 'sign-in', reason: 'YouTube asked to sign in.' });
    });
    expect(await api.testYouTubeProxy()).toEqual({
      verdict: 'sign-in',
      reason: 'YouTube asked to sign in.',
    });
    expect(calls[0]?.[0]).toBe('/api/settings/youtube-proxy-test');
    expect(calls[0]?.[1]?.method).toBe('POST');
  });
});
