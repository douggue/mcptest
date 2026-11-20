/**
 * One message to the owner through the Telegram Bot API.
 *
 * Telegram puts the bot's token in the address of every request, so the
 * address is never logged or repeated: a failure is reported in words of our
 * own, and anything Telegram or the network says has the token taken out
 * first. Nothing here throws or waits; the caller is told what happened and
 * decides when to try again.
 */
import { z } from 'zod';

const API_BASE = 'https://api.telegram.org';
export const TELEGRAM_TIMEOUT_MS = 15_000;
/** Telegram's limit on one message, counted after its HTML is read. */
export const TELEGRAM_MAX_MESSAGE_LENGTH = 4096;
const MS_PER_SECOND = 1000;
const MAX_ERROR_TEXT = 200;
const TOKEN_PLACEHOLDER = '[token]';
/** Anything shaped like a bot token, in case one appears that is not ours. */
const TOKEN_SHAPE = /\d{5,}:[\w-]{20,}/g;
/** Used when Telegram says "too fast" without saying how long to wait. */
const DEFAULT_RETRY_AFTER_S = 30;
const MAX_RETRY_AFTER_S = 24 * 60 * 60;

const BAD_TOKEN =
  'Telegram did not accept the bot token. Check TELEGRAM_BOT_TOKEN against the token @BotFather gave you.';
const NOT_ALLOWED =
  'The Telegram bot may not write to this chat. Open the chat with your bot and press Start (or add the bot to the group), then check TELEGRAM_CHAT_ID.';
const CHAT_NOT_FOUND =
  'Telegram cannot find the chat. Check TELEGRAM_CHAT_ID, and send your bot a message first so the chat exists.';

export type SendResult =
  | { readonly kind: 'sent' }
  /** Telegram asked for a pause; nothing should be sent for this many seconds. */
  | { readonly kind: 'retry_after'; readonly seconds: number }
  /** The token or the chat is wrong; trying again changes nothing until the owner fixes it. */
  | { readonly kind: 'misconfigured'; readonly message: string }
  /**
   * Telegram read this message and would not take it (a 400 that is not about
   * the chat): the fault is in the message, so sending the same one again will
   * get the same answer, though the next message may be fine.
   */
  | { readonly kind: 'rejected'; readonly message: string }
  /** The network, or Telegram itself. */
  | { readonly kind: 'failed'; readonly message: string };

export interface TelegramOptions {
  /** The bot's token, from the TELEGRAM_BOT_TOKEN setting. Never stored or logged. */
  readonly botToken: string;
  readonly chatId: string;
  /** Replaces the network; used by tests. */
  readonly fetch?: typeof fetch;
}

export interface MessageOptions {
  /** Whether Telegram shows a preview of the first link. Off unless asked for. */
  readonly preview?: boolean;
}

/** Sends one message. Used by the alerts through this shape, so a test can stand in for it. */
export type Send = (html: string, message?: MessageOptions) => Promise<SendResult>;

const replySchema = z.object({
  ok: z.boolean().optional(),
  description: z.string().optional(),
  parameters: z.object({ retry_after: z.number().optional() }).optional(),
});

type Reply = z.infer<typeof replySchema>;

const withoutToken = (text: string, token: string): string =>
  text
    .split(token)
    .join(TOKEN_PLACEHOLDER)
    .replace(TOKEN_SHAPE, TOKEN_PLACEHOLDER)
    .slice(0, MAX_ERROR_TEXT);

function retryAfter(reply: Reply): SendResult {
  const asked = reply.parameters?.retry_after;
  const seconds =
    asked === undefined || !Number.isFinite(asked) || asked < 1
      ? DEFAULT_RETRY_AFTER_S
      : Math.min(MAX_RETRY_AFTER_S, Math.ceil(asked));
  return { kind: 'retry_after', seconds };
}

/** What a refusal means, in words the owner can act on. */
function refusal(status: number, reply: Reply, token: string): SendResult {
  const description = reply.description ?? '';
  if (status === 429) return retryAfter(reply);
  // Telegram answers 404 to a token that is not shaped like one.
  if (status === 401 || status === 404) return { kind: 'misconfigured', message: BAD_TOKEN };
  if (status === 403) return { kind: 'misconfigured', message: NOT_ALLOWED };
  if (status === 400 && /chat not found/i.test(description)) {
    return { kind: 'misconfigured', message: CHAT_NOT_FOUND };
  }
  const detail = withoutToken(description, token);
  const message = `Telegram refused the message (${status}): ${detail}`;
  return { kind: status === 400 ? 'rejected' : 'failed', message };
}

async function post(body: string, options: TelegramOptions): Promise<Response | SendResult> {
  try {
    return await (options.fetch ?? fetch)(`${API_BASE}/bot${options.botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      // The token goes to Telegram only: a reply that points elsewhere is not followed.
      redirect: 'error',
      signal: AbortSignal.timeout(TELEGRAM_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      const seconds = TELEGRAM_TIMEOUT_MS / MS_PER_SECOND;
      return { kind: 'failed', message: `Telegram did not answer within ${seconds} seconds` };
    }
    const reason = error instanceof Error ? error.message : String(error);
    return {
      kind: 'failed',
      message: `Telegram could not be reached: ${withoutToken(reason, options.botToken)}`,
    };
  }
}

/**
 * Sends one message, written in Telegram's HTML, to the owner's chat. Never
 * throws: the answer says whether it was accepted and, if not, what to do.
 */
export async function sendMessage(
  html: string,
  options: TelegramOptions,
  message: MessageOptions = {},
): Promise<SendResult> {
  const body = JSON.stringify({
    chat_id: options.chatId,
    text: html,
    parse_mode: 'HTML',
    disable_web_page_preview: message.preview !== true,
  });
  const response = await post(body, options);
  if (!(response instanceof Response)) return response;
  const parsed = replySchema.safeParse(await response.json().catch(() => null));
  const reply: Reply = parsed.success ? parsed.data : {};
  if (!response.ok) return refusal(response.status, reply, options.botToken);
  if (reply.ok !== true) {
    return { kind: 'failed', message: 'Telegram sent a reply that could not be read' };
  }
  return { kind: 'sent' };
}

/** `sendMessage` bound to one bot and one chat. */
export const createSender =
  (options: TelegramOptions): Send =>
  (html, message) =>
    sendMessage(html, options, message);
