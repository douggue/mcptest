import { describe, expect, test } from 'vitest';
import {
  GEMINI_ENDPOINT,
  askGemini,
  watchWithGemini,
  type GeminiFetch,
  type GeminiSettings,
} from '../../src/engines/geminiVideo';

const KEY = 'AIzaSyD-stand-in-key-0123456789abcdef';
const settings: GeminiSettings = { apiKey: KEY, model: 'gemini-4-hydrogen' };
const VIDEO_ID = 'dQw4w9WgXcQ';
const request = {
  videoId: VIDEO_ID,
  question: 'Describe the sound design second by second.',
  systemPrompt: 'You are a YouTube analyst.',
  timeoutMs: 1000,
};

interface Sent {
  readonly url: string;
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Record<string, unknown>;
  readonly redirect: string;
}

const completed = (...texts: string[]) => ({
  id: 'v1_abc',
  status: 'completed',
  steps: [
    { type: 'thought', content: [{ type: 'text', text: 'thinking' }] },
    { type: 'model_output', content: texts.map((text) => ({ type: 'text', text })) },
  ],
  usage: { total_tokens: 49 },
});

/** A stand-in for Google that records what it was sent and answers as told. */
function google(reply: unknown, status = 200) {
  const sent: Sent[] = [];
  const fetch: GeminiFetch = async (url, init) => {
    sent.push({
      url,
      method: init.method,
      headers: init.headers,
      body: JSON.parse(init.body) as Record<string, unknown>,
      redirect: init.redirect,
    });
    return new Response(typeof reply === 'string' ? reply : JSON.stringify(reply), { status });
  };
  return { sent, fetch };
}

describe('watchWithGemini', () => {
  test('asks the model to watch the public video by its link and returns the answer', async () => {
    const { sent, fetch } = google(
      completed('0:00 a low drone. ', '0:04 a whoosh into the title.'),
    );

    await expect(watchWithGemini(request, settings, { fetch })).resolves.toEqual({
      text: '0:00 a low drone. 0:04 a whoosh into the title.',
      turns: null,
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ url: GEMINI_ENDPOINT, method: 'POST', redirect: 'error' });
    expect(sent[0]?.body).toEqual({
      model: 'gemini-4-hydrogen',
      input: [
        { type: 'text', text: 'Describe the sound design second by second.' },
        { type: 'video', uri: `https://www.youtube.com/watch?v=${VIDEO_ID}` },
      ],
      system_instruction: 'You are a YouTube analyst.',
      store: false,
    });
  });

  test('sends the key in a header and nowhere else', async () => {
    const { sent, fetch } = google(completed('ok'));
    await watchWithGemini(request, settings, { fetch });

    expect(sent[0]?.headers).toEqual({ 'x-goog-api-key': KEY, 'content-type': 'application/json' });
    expect(sent[0]?.url).not.toContain(KEY);
    expect(JSON.stringify(sent[0]?.body)).not.toContain(KEY);
  });

  test.each(['', 'short', 'dQw4w9WgXcQ&t=1', 'https://youtu.be/dQw4w9WgXcQ', 'dQw4w9WgXc!'])(
    'refuses %j, which is not a video id, before asking anything',
    async (videoId) => {
      const { sent, fetch } = google(completed('never'));

      await expect(
        watchWithGemini({ ...request, videoId }, settings, { fetch }),
      ).rejects.toMatchObject({ reason: 'failed', message: expect.stringMatching(/video id/) });
      expect(sent).toEqual([]);
    },
  );

  test.each([
    ['quota_exceeded', 'Daily quota exceeded for this model.'],
    ['rate_limit_exceeded', 'Too many requests.'],
  ])('maps a 429 (%s) to a plan limit, in Google’s words', async (code, message) => {
    const { fetch } = google({ error: { code, message } }, 429);

    await expect(watchWithGemini(request, settings, { fetch })).rejects.toMatchObject({
      reason: 'limit',
      message: expect.stringContaining(message),
    });
  });

  test.each([401, 403])('says the key was refused on a %d', async (status) => {
    const { fetch } = google(
      { error: { code: 'authentication', message: 'API key not valid.' } },
      status,
    );

    await expect(watchWithGemini(request, settings, { fetch })).rejects.toMatchObject({
      reason: 'not-signed-in',
      message: expect.stringMatching(/GEMINI_API_KEY/),
    });
  });

  test('reports any other refusal with its status and reason', async () => {
    const { fetch } = google(
      { error: { code: 'invalid_request', message: 'The video is private.' } },
      400,
    );

    await expect(watchWithGemini(request, settings, { fetch })).rejects.toMatchObject({
      reason: 'failed',
      message: expect.stringMatching(/status 400.*The video is private\./),
    });
  });

  test('maps a 504 to taking too long', async () => {
    const { fetch } = google({ error: { code: 'deadline_exceeded', message: 'Too slow.' } }, 504);

    await expect(watchWithGemini(request, settings, { fetch })).rejects.toMatchObject({
      reason: 'timeout',
    });
  });

  test('never repeats the key, even when an error message does', async () => {
    const echoing = google({ error: { message: `Bad key ${KEY} for /v1beta/interactions` } }, 400);
    const throwing: GeminiFetch = async () => {
      throw new Error(`connect failed for key ${KEY}`);
    };

    for (const fetch of [echoing.fetch, throwing]) {
      const failure = await watchWithGemini(request, settings, { fetch }).then(
        () => new Error('it did not fail'),
        (error: unknown) => error as Error,
      );
      expect(failure.message).not.toContain(KEY);
    }
  });

  test('gives up after its time limit', async () => {
    const never: GeminiFetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(init.signal.reason as Error));
      });

    await expect(
      watchWithGemini({ ...request, timeoutMs: 10 }, settings, { fetch: never }),
    ).rejects.toMatchObject({
      reason: 'timeout',
      message: expect.stringMatching(/took too long/),
    });
  });

  test('stops when Jgtube is closing', async () => {
    const closing = new AbortController();
    const never: GeminiFetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(init.signal.reason as Error));
      });
    const pending = watchWithGemini(request, settings, { fetch: never, signal: closing.signal });
    closing.abort();

    await expect(pending).rejects.toMatchObject({
      reason: 'failed',
      message: expect.stringMatching(/Jgtube is closing/),
    });
  });

  test('says Google could not be reached, without the details', async () => {
    const down: GeminiFetch = async () => {
      throw new Error('getaddrinfo ENOTFOUND generativelanguage.googleapis.com');
    };

    await expect(watchWithGemini(request, settings, { fetch: down })).rejects.toMatchObject({
      reason: 'failed',
      message:
        'Google could not be reached to watch the video. Check the connection and try again.',
    });
  });

  test.each([
    ['a reply that is not JSON', '<html>error</html>', /could not be read/],
    ['a reply with no answer in it', { status: 'completed', steps: [] }, /no answer/],
    [
      'an answer that was cut off',
      { status: 'incomplete', steps: [{ type: 'model_output', content: [] }] },
      /incomplete/,
    ],
    [
      'a run that failed on Google’s side',
      { status: 'failed', errors: [{ code: 'x', message: 'The video could not be processed.' }] },
      /The video could not be processed\./,
    ],
  ])('reports %s', async (_, reply, wording) => {
    const { fetch } = google(reply);

    await expect(watchWithGemini(request, settings, { fetch })).rejects.toMatchObject({
      reason: 'failed',
      message: expect.stringMatching(wording),
    });
  });
});

describe('askGemini', () => {
  test('puts one question in words only, to prove the key works without watching anything', async () => {
    const { sent, fetch } = google(completed('ready'));

    await expect(askGemini('Reply with the one word: ready', settings, { fetch })).resolves.toEqual(
      {
        text: 'ready',
        turns: null,
      },
    );
    expect(sent[0]?.body).toEqual({
      model: 'gemini-4-hydrogen',
      input: [{ type: 'text', text: 'Reply with the one word: ready' }],
      store: false,
    });
  });
});
