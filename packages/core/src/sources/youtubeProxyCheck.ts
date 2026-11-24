import { readCapped } from './images';
import { MAX_WATCH_PAGE_BYTES, WATCH_HEADERS } from './watchHtml';
import { makeYouTubeFetch } from './youtubeFetch';
import { hideProxySecret } from './youtubeProxy';

/**
 * The settings screen's Test: one public YouTube page fetched through the
 * owner's proxy, and what came back in a word and a plain reason. One
 * request, made only when the owner presses the button.
 */

/** The first video on YouTube: public, short, and unlikely ever to be taken down. */
export const PROXY_CHECK_PAGE = 'https://www.youtube.com/watch?v=jNQXAC9IVRw';
const TIMEOUT_SECONDS = 15;
const MAX_REASON_LENGTH = 160;

export type ProxyVerdict = 'reachable' | 'refused' | 'sign-in';

export interface ProxyCheck {
  readonly verdict: ProxyVerdict;
  /** One plain sentence; never the proxy's address or password. */
  readonly reason: string;
}

export type ProxyCheckFetch = (url: string, init: RequestInit) => Promise<Response>;

const REACHABLE = 'YouTube answered through the proxy with a public video page.';
const SIGN_IN_BOT =
  'YouTube asked to sign in to confirm this is not a bot, so reading from this address will fail.';
const SIGN_IN_PAGE =
  'YouTube sent the page to a sign-in or cookie consent page instead of showing it.';
const AUTH = 'The proxy asked for a user name and password, or did not accept the ones given.';
const PLAYER_STATUS = /"playabilityStatus"\s*:\s*\{\s*"status"\s*:\s*"([A-Z_]+)"/;
const SIGN_IN_HOSTS = /^https:\/\/(consent\.youtube\.com|accounts\.google\.com)\//;
/** Google's "unusual traffic" check, where an address it suspects of being a program is sent. */
const SORRY_PAGE = /^https:\/\/(www\.)?google\.[a-z.]+\/sorry\//;
const UNUSUAL_TRAFFIC =
  'YouTube sent the page to Google’s “unusual traffic” check, which turns this address away for now.';

/** Plain reasons for the ways a connection to the proxy fails, by the error's code. */
const BY_CODE: Readonly<Record<string, string>> = {
  ECONNREFUSED: 'Nothing answered at the proxy’s address and port.',
  ECONNRESET: 'The proxy closed the connection.',
  ENOTFOUND: 'The proxy’s host name was not found.',
  EAI_AGAIN: 'The proxy’s host name was not found.',
  ETIMEDOUT: 'The proxy did not answer in time.',
  UND_ERR_CONNECT_TIMEOUT: 'The proxy did not answer in time.',
  EHOSTUNREACH: 'The proxy’s address cannot be reached from this computer.',
  ENETUNREACH: 'The proxy’s address cannot be reached from this computer.',
};

const refused = (reason: string): ProxyCheck => ({ verdict: 'refused', reason });

function field(error: unknown, name: 'code' | 'message'): string {
  const own = (error as Record<string, unknown> | null)?.[name];
  const cause = (error as { cause?: Record<string, unknown> } | null)?.cause?.[name];
  return [own, cause].filter((value): value is string => typeof value === 'string').join(' ');
}

/** A failure to get any answer, in plain words. */
function failureReason(error: unknown, proxy: string): ProxyCheck {
  if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
    return refused(`No answer came within ${TIMEOUT_SECONDS} seconds.`);
  }
  const code = field(error, 'code');
  const known = Object.keys(BY_CODE).find((name) => code.includes(name));
  if (known !== undefined) return refused(BY_CODE[known] ?? '');
  const message = field(error, 'message');
  if (/\b407\b|auth/i.test(message)) return refused(AUTH);
  const reason = hideProxySecret(message, proxy).slice(0, MAX_REASON_LENGTH);
  return refused(
    `The proxy could not reach YouTube: ${reason.replace(/\.$/, '') || 'no reason was given'}.`,
  );
}

/** What YouTube's answer says, in a word and a reason. */
async function answerVerdict(response: Response): Promise<ProxyCheck> {
  const location = response.headers.get('location') ?? '';
  if (response.status >= 300 && response.status < 400) {
    if (SORRY_PAGE.test(location)) return refused(UNUSUAL_TRAFFIC);
    return SIGN_IN_HOSTS.test(location)
      ? { verdict: 'sign-in', reason: SIGN_IN_PAGE }
      : refused(`YouTube sent the page somewhere else (status ${response.status}).`);
  }
  if (response.status === 403 || response.status === 429) {
    return refused(`YouTube turned this address away (status ${response.status}).`);
  }
  if (response.status === 407) return refused(AUTH);
  if (!response.ok) return refused(`The proxy or YouTube answered with status ${response.status}.`);
  const bytes = await readCapped(response, MAX_WATCH_PAGE_BYTES);
  const page = bytes === null ? '' : Buffer.from(bytes).toString('utf8');
  const status = PLAYER_STATUS.exec(page)?.[1];
  if (status === 'LOGIN_REQUIRED' || /not a bot/i.test(page)) {
    return { verdict: 'sign-in', reason: SIGN_IN_BOT };
  }
  return { verdict: 'reachable', reason: REACHABLE };
}

/**
 * Fetches one public YouTube page through `proxy` and says whether YouTube
 * could be reached, refused, or asked to sign in. Never throws.
 */
export async function checkYouTubeProxy(
  proxy: string,
  fetcher: ProxyCheckFetch = makeYouTubeFetch(() => proxy),
  url: string = PROXY_CHECK_PAGE,
): Promise<ProxyCheck> {
  try {
    const response = await fetcher(url, {
      headers: WATCH_HEADERS,
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_SECONDS * 1000),
    });
    return await answerVerdict(response);
  } catch (error) {
    return failureReason(error, proxy);
  }
}
