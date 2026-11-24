import { describe, expect, test } from 'vitest';
import { loadConfig } from '../src/config';
import {
  YOUTUBE_PROXY_RULE,
  YOUTUBE_PROXY_SETTING,
  hideProxySecret,
  youtubeProxyOf,
} from '../src/sources/youtubeProxy';

const problemOf = (value: string): string | null => {
  const parsed = YOUTUBE_PROXY_RULE.safeParse(value);
  return parsed.success ? null : (parsed.error.issues[0]?.message ?? 'invalid');
};

describe('the proxy setting rule', () => {
  test.each([
    'http://proxy.example.com:8080',
    'https://proxy.example.com:443',
    'socks5://127.0.0.1:1080',
    'socks5://user:pa%40ss@gate.example.net:7000',
    'http://user:secret@10.0.0.2:3128/',
    'http://[::1]:8080',
  ])('accepts %s', (value) => {
    expect(problemOf(value)).toBeNull();
  });

  test.each([
    ['ftp://proxy.example.com:21', 'must start with http://, https:// or socks5://'],
    ['socks4://proxy.example.com:1080', 'must start with http://, https:// or socks5://'],
    ['proxy.example.com:8080', 'must start with http://, https:// or socks5://'],
    ['http://proxy.example.com', 'must name a host and a port, as host:port'],
    ['http://:8080', 'must name a host and a port, as host:port'],
    ['http://proxy.example.com:0', 'must have a port from 1 to 65535'],
    ['http://proxy.example.com:65536', 'must have a port from 1 to 65535'],
    ['http://proxy.example.com:8080/path', 'must be only the address, with nothing after the port'],
    ['http://proxy.example.com:8080?x=1', 'must be only the address, with nothing after the port'],
    ['http://pro xy.example.com:8080', 'must name a host and a port, as host:port'],
  ])('refuses %s', (value, message) => {
    expect(problemOf(value)).toBe(message);
  });

  test('never repeats the value, password included, in a refusal', () => {
    const value = 'http://owner:hunter2-secret@proxy.example.com:99999';
    const message = problemOf(value) ?? '';
    expect(message).not.toContain('hunter2');
    expect(message).not.toContain('proxy.example.com');
  });

  test('is checked when Jgtube starts, without the value in the error', () => {
    expect(() => loadConfig({ [YOUTUBE_PROXY_SETTING]: 'gopher://user:hunter2@host:70' })).toThrow(
      /JGTUBE_YOUTUBE_PROXY: must start with/,
    );
    expect(() =>
      loadConfig({ [YOUTUBE_PROXY_SETTING]: 'gopher://user:hunter2@host:70' }),
    ).not.toThrow(/hunter2/);
    expect(() => loadConfig({ [YOUTUBE_PROXY_SETTING]: 'socks5://host:1080' })).not.toThrow();
  });
});

describe('the proxy in force', () => {
  test('is none when the setting is missing or empty', () => {
    expect(youtubeProxyOf({})).toBeNull();
    expect(youtubeProxyOf({ [YOUTUBE_PROXY_SETTING]: '   ' })).toBeNull();
  });

  test('is the trimmed address when it is set', () => {
    expect(youtubeProxyOf({ [YOUTUBE_PROXY_SETTING]: ' socks5://h:1080 ' })).toBe(
      'socks5://h:1080',
    );
  });

  test('refuses to go on with an address changed by hand into a bad one, without repeating it', () => {
    const env = { [YOUTUBE_PROXY_SETTING]: 'http://user:hunter2@host' };
    expect(() => youtubeProxyOf(env)).toThrow(/Proxy for YouTube setting is not valid/);
    expect(() => youtubeProxyOf(env)).not.toThrow(/hunter2/);
  });
});

describe('hiding the proxy in a message', () => {
  test('takes out the address, the user name and the password', () => {
    const proxy = 'http://owner:hunter2@proxy.example.com:3128';
    const text = `connect to http://owner:hunter2@proxy.example.com:3128 failed; auth owner:hunter2; hunter2`;
    const hidden = hideProxySecret(text, proxy);
    expect(hidden).not.toContain('hunter2');
    expect(hidden).not.toContain('owner');
    expect(hidden).toContain('the proxy');
  });

  test('takes out a password written in its decoded form too', () => {
    const hidden = hideProxySecret('password p@ss! refused', 'socks5://u:p%40ss!@h:1080');
    expect(hidden).not.toContain('p@ss!');
  });

  test('leaves a message alone when there is no proxy', () => {
    expect(hideProxySecret('status 403', null)).toBe('status 403');
  });
});
