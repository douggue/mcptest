import { describe, expect, test, vi } from 'vitest';
import {
  TELEGRAM_TIMEOUT_MS,
  createSender,
  sendMessage,
  type TelegramOptions,
} from '../../src/alerts/telegram';

/** Shaped like a bot token and plainly not one. */
const TOKEN = '1234567890:TEST-token-not-a-real-one-0123456789';
const CHAT = '-1001234567890';

interface Sent {
  readonly url: string;
  readonly init: RequestInit;
}

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** A stand-in for the network that notes each request and answers as told. */
function telegram(answer: () => Response | Promise<Response>) {
  const sent: Sent[] = [];
  const fake: typeof fetch = async (input, init) => {
    sent.push({ url: String(input), init: init ?? {} });
    return answer();
  };
  const options: TelegramOptions = { botToken: TOKEN, chatId: CHAT, fetch: fake };
  return { sent, options };
}

const accepted = (): Response => json(200, { ok: true, result: { message_id: 7 } });

describe('sendMessage', () => {
  test('posts the text as HTML to the bot, with link previews off unless asked for', async () => {
    const { sent, options } = telegram(accepted);

    const result = await sendMessage('<b>Hello</b>', options);

    expect(result).toEqual({ kind: 'sent' });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toBe(`https://api.telegram.org/bot${TOKEN}/sendMessage`);
    expect(sent[0]?.init.method).toBe('POST');
    expect(sent[0]?.init.headers).toEqual({ 'content-type': 'application/json' });
    expect(JSON.parse(String(sent[0]?.init.body))).toEqual({
      chat_id: CHAT,
      text: '<b>Hello</b>',
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    });
  });

  test('lets Telegram preview the link when asked to', async () => {
    const { sent, options } = telegram(accepted);

    await sendMessage('A link', options, { preview: true });

    expect(JSON.parse(String(sent[0]?.init.body)).disable_web_page_preview).toBe(false);
  });

  test('follows no redirect and gives up after fifteen seconds', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const { sent, options } = telegram(accepted);

    await sendMessage('Hello', options);

    expect(sent[0]?.init.redirect).toBe('error');
    expect(TELEGRAM_TIMEOUT_MS).toBe(15_000);
    expect(timeout).toHaveBeenCalledWith(15_000);
    expect(sent[0]?.init.signal).toBeInstanceOf(AbortSignal);
    timeout.mockRestore();
  });

  test('hands back how long Telegram asks to wait instead of waiting', async () => {
    const { options } = telegram(() =>
      json(429, {
        ok: false,
        error_code: 429,
        description: 'Too Many Requests: retry after 37',
        parameters: { retry_after: 37 },
      }),
    );

    expect(await sendMessage('Hello', options)).toEqual({ kind: 'retry_after', seconds: 37 });
  });

  test('waits half a minute when Telegram says too fast without saying how long', async () => {
    const { options } = telegram(() => json(429, { ok: false }));

    expect(await sendMessage('Hello', options)).toEqual({ kind: 'retry_after', seconds: 30 });
  });

  test('never waits longer than a day, whatever Telegram asks', async () => {
    const { options } = telegram(() => json(429, { parameters: { retry_after: 9_999_999 } }));

    expect(await sendMessage('Hello', options)).toEqual({ kind: 'retry_after', seconds: 86_400 });
  });

  test.each([
    [401, 'Unauthorized', /did not accept the bot token.*TELEGRAM_BOT_TOKEN/],
    [404, 'Not Found', /did not accept the bot token/],
    [403, 'Forbidden: bot was blocked by the user', /may not write to this chat.*press Start/],
    [400, 'Bad Request: chat not found', /cannot find the chat.*TELEGRAM_CHAT_ID/],
  ])(
    'calls a %i "%s" a fault in the settings, in plain words',
    async (status, description, words) => {
      const { options } = telegram(() => json(status, { ok: false, description }));

      const result = await sendMessage('Hello', options);

      expect(result.kind).toBe('misconfigured');
      expect(result).toHaveProperty('message', expect.stringMatching(words));
      expect(JSON.stringify(result)).not.toContain(TOKEN);
    },
  );

  test('reports any other refusal with what Telegram said, the token taken out', async () => {
    const { options } = telegram(() =>
      json(400, { ok: false, description: `Bad Request: can't parse entities near bot${TOKEN}` }),
    );

    const result = await sendMessage('Hello', options);

    expect(result).toEqual({
      kind: 'failed',
      message:
        "Telegram refused the message (400): Bad Request: can't parse entities near bot[token]",
    });
  });

  test('reports a refusal whose reply is not JSON by its status', async () => {
    const { options } = telegram(() => new Response('<html>Bad gateway</html>', { status: 502 }));

    expect(await sendMessage('Hello', options)).toEqual({
      kind: 'failed',
      message: 'Telegram refused the message (502): ',
    });
  });

  test('strips the token from a network failure, which may quote the address', async () => {
    const { options } = telegram(() => {
      throw new Error(`request to https://api.telegram.org/bot${TOKEN}/sendMessage failed`);
    });

    const result = await sendMessage('Hello', options);

    expect(result.kind).toBe('failed');
    expect(JSON.stringify(result)).not.toContain(TOKEN);
    expect(JSON.stringify(result)).not.toContain('TEST-token');
    expect(result).toHaveProperty('message', expect.stringContaining('could not be reached'));
  });

  test('strips anything shaped like a token, even one that is not ours', async () => {
    const { options } = telegram(() => {
      throw 'failed for bot99999999:another-token-shaped-string-0123456789';
    });

    const result = await sendMessage('Hello', options);

    expect(JSON.stringify(result)).not.toContain('another-token');
  });

  test('says so when Telegram does not answer in time', async () => {
    const { options } = telegram(() => {
      throw new DOMException('The operation timed out', 'TimeoutError');
    });

    expect(await sendMessage('Hello', options)).toEqual({
      kind: 'failed',
      message: 'Telegram did not answer within 15 seconds',
    });
  });

  test('does not take a 200 that does not say ok as accepted', async () => {
    const { options } = telegram(() => json(200, { ok: false }));

    expect(await sendMessage('Hello', options)).toEqual({
      kind: 'failed',
      message: 'Telegram sent a reply that could not be read',
    });
  });
});

describe('createSender', () => {
  test('sends to the bot and chat it was made with', async () => {
    const { sent, options } = telegram(accepted);

    const result = await createSender(options)('Hello', { preview: true });

    expect(result).toEqual({ kind: 'sent' });
    expect(JSON.parse(String(sent[0]?.init.body))).toMatchObject({ chat_id: CHAT, text: 'Hello' });
  });
});
