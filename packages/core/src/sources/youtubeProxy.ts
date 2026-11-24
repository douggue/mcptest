import { z } from 'zod';

/**
 * The owner's one proxy for YouTube: an address that Jgtube's reading of
 * YouTube and its video downloads go through, and nothing else. It is a
 * secret, since it may carry a user name and password, so no message here
 * ever repeats it.
 */

/** The setting's name in `.env`. */
export const YOUTUBE_PROXY_SETTING = 'JGTUBE_YOUTUBE_PROXY';

const MAX_LENGTH = 1000;
const MAX_PORT = 65_535;
/** The kinds of proxy Jgtube can use. */
const SCHEME = /^(https?|socks5):\/\//i;
/**
 * scheme://[user[:password]@]host:port[/], nothing else. The host is a name,
 * an IPv4 address or an IPv6 address in brackets; the user name and password
 * are written percent-encoded where they need to be.
 */
const SHAPE = /^[a-z0-9]+:\/\/(?:[^@/\s?#]*@)?(\[[0-9a-f:.]+\]|[a-z0-9.-]+)(?::(\d{1,5}))?(.*)$/i;

const NOT_A_SCHEME = 'must start with http://, https:// or socks5://';
const NO_HOST_OR_PORT = 'must name a host and a port, as host:port';
const BAD_PORT = `must have a port from 1 to ${MAX_PORT}`;
const TRAILING = 'must be only the address, with nothing after the port';

/** Why an address cannot be used as the proxy, in words that never repeat it; null when it can. */
function proxyProblem(value: string): string | null {
  if (!SCHEME.test(value)) return NOT_A_SCHEME;
  const match = SHAPE.exec(value);
  if (match === null) return NO_HOST_OR_PORT;
  const [, host, port, rest] = match;
  if (!host || port === undefined) return rest?.startsWith(':') ? BAD_PORT : NO_HOST_OR_PORT;
  if (rest !== '' && rest !== '/') return TRAILING;
  const number = Number(port);
  if (number < 1 || number > MAX_PORT) return BAD_PORT;
  try {
    return new URL(value).hostname === '' ? NO_HOST_OR_PORT : null;
  } catch {
    return NO_HOST_OR_PORT;
  }
}

/** The rule the setting is read and saved with. */
export const YOUTUBE_PROXY_RULE = z
  .string()
  .max(MAX_LENGTH, 'is too long to be a proxy address')
  .superRefine((value, context) => {
    const problem = proxyProblem(value.trim());
    if (problem !== null) context.addIssue({ code: 'custom', message: problem });
  });

const INVALID = `The Proxy for YouTube setting is not valid, so Jgtube will not read YouTube until it is corrected or cleared in Settings.`;

/**
 * The proxy in force: the trimmed address, or null when none is set. An
 * address that is not valid (changed by hand in `.env`) is refused rather
 * than ignored, so YouTube is never read without the proxy the owner asked for.
 */
export function youtubeProxyOf(env: Readonly<Record<string, string | undefined>>): string | null {
  const value = env[YOUTUBE_PROXY_SETTING]?.trim();
  if (!value) return null;
  if (proxyProblem(value) !== null) throw new Error(INVALID);
  return value;
}

const HIDDEN = 'the proxy';

const escaped = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const decoded = (text: string): string => {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
};

/** `text` with the proxy's address, its user name with password, and its password taken out. */
export function hideProxySecret(text: string, proxy: string | null): string {
  if (proxy === null) return text;
  let url: URL | null = null;
  try {
    url = new URL(proxy);
  } catch {
    // Not an address: only the text as given can be hidden.
  }
  const user = url ? decoded(url.username) : '';
  const password = url ? decoded(url.password) : '';
  const secrets = [
    proxy,
    url?.href ?? '',
    user && password ? `${user}:${password}` : '',
    url ? `${url.username}:${url.password}` : '',
    password,
    url?.password ?? '',
  ].filter((secret) => secret.length > 1 && secret !== ':');
  return secrets
    .sort((a, b) => b.length - a.length)
    .reduce((hidden, secret) => hidden.replace(new RegExp(escaped(secret), 'g'), HIDDEN), text);
}
