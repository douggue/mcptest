/**
 * Has a Gemini model watch one public YouTube video, by its link, and answer
 * a question about it: picture and sound. This is the second way to watch a
 * video, used when the owner has put a `GEMINI_API_KEY` in `.env`.
 *
 * NOT TRIED AGAINST GOOGLE: there was no key where this was written. It is
 * built to Google's documentation as read in November 2026:
 * - "Video understanding" (aistudio.google.com/docs/video-understanding): a
 *   POST to `/v1beta/interactions` with the key in an `x-goog-api-key` header
 *   and a body of `model` and `input`, where the video is the part
 *   `{"type": "video", "uri": "<YouTube link>"}`. Its examples use the model
 *   `gemini-4-hydrogen`.
 * - "Create interaction" (aistudio.google.com/api-reference/interactions-api):
 *   `system_instruction` and `store` in the request; in the reply, `status`
 *   (`completed` when it worked) and `steps`, where the answer is the text in
 *   the content of the `model_output` step.
 * - "API errors" (aistudio.google.com/docs/api-errors): a refusal is
 *   `{"error": {"code", "message"}}`; 429 is a rate or daily limit, 401 and
 *   403 a key that is missing, wrong or not allowed, 504 a deadline.
 *
 * Limits, from the first page: only public videos (not private or unlisted);
 * on the free tier no more than 8 hours of YouTube video a day; a model with
 * a one-million-token window takes about an hour of video at the usual
 * detail, three at low detail. The feature is a preview, and Google says its
 * price and limits are likely to change.
 *
 * The key is sent in a header and nowhere else: never in the address, never
 * in the question, and it is taken out of any message before it is passed on.
 * `store: false` asks Google not to keep the question and answer.
 */
import { z } from 'zod';
import { EngineRunError, said } from './failure';
import type { EngineRunResult } from './types';
import { NOT_A_VIDEO_ID, isVideoId, videoLink } from './videoId';

export const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/interactions';
/** The model in Google's own examples of watching a YouTube video. */
export const DEFAULT_GEMINI_MODEL = 'gemini-4-hydrogen';
const KEY_HEADER = 'x-goog-api-key';
const COMPLETED = 'completed';
const ANSWER_STEP = 'model_output';
const HTTP_LIMIT = 429;
const HTTP_REFUSED_KEY: readonly number[] = [401, 403];
const HTTP_DEADLINE = 504;
/** A one-line question to prove the key works is answered in seconds. */
const ASK_TIMEOUT_MS = 60_000;

export interface GeminiSettings {
  /** The owner's key. Sent only as a request header; never logged. */
  readonly apiKey: string;
  readonly model: string;
}

export interface GeminiVideoRequest {
  readonly videoId: string;
  readonly question: string;
  readonly systemPrompt: string;
  readonly timeoutMs: number;
}

/** The part of `fetch` this module uses, so tests can stand in for Google. */
export type GeminiFetch = (
  url: string,
  init: {
    readonly method: 'POST';
    readonly headers: Readonly<Record<string, string>>;
    readonly body: string;
    readonly signal: AbortSignal;
    readonly redirect: 'error';
  },
) => Promise<Response>;

export interface GeminiDeps {
  readonly fetch?: GeminiFetch;
  /** Aborted when Jgtube is closing. */
  readonly signal?: AbortSignal;
}

const replySchema = z.object({
  status: z.string().optional(),
  steps: z
    .array(
      z.object({
        type: z.string().optional(),
        content: z
          .array(z.object({ type: z.string().optional(), text: z.string().optional() }))
          .optional(),
      }),
    )
    .optional(),
  errors: z.array(z.object({ message: z.string().optional() })).optional(),
});
type GeminiReply = z.infer<typeof replySchema>;

const refusalSchema = z.object({ error: z.object({ message: z.string().optional() }) });

type Part =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'video'; readonly uri: string };

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** Google's words, safe to show: the key taken out, then paths and control characters. */
const scrub = (text: string, { apiKey }: GeminiSettings): string =>
  said(text.split(apiKey).join('<key>'));

function refusal(status: number, body: string, settings: GeminiSettings): EngineRunError {
  const parsed = refusalSchema.safeParse(parseJson(body));
  const reason = scrub(parsed.success ? (parsed.data.error.message ?? '') : '', settings);
  if (status === HTTP_LIMIT) {
    return new EngineRunError(
      'limit',
      `The Gemini API key has no allowance left for now${reason ? `: ${reason}` : '.'}`,
    );
  }
  if (HTTP_REFUSED_KEY.includes(status)) {
    return new EngineRunError(
      'not-signed-in',
      'Google refused the Gemini API key. Check GEMINI_API_KEY in the .env file.',
    );
  }
  return new EngineRunError(
    status === HTTP_DEADLINE ? 'timeout' : 'failed',
    `Gemini could not answer (status ${status})${reason ? `: ${reason}` : ''}`,
  );
}

/** The answer in a reply that came back as a success, or the reason there is none. */
function answerOf(body: string, settings: GeminiSettings): EngineRunResult {
  const parsed = replySchema.safeParse(parseJson(body));
  if (!parsed.success) throw new EngineRunError('failed', "Gemini's reply could not be read.");
  const reply: GeminiReply = parsed.data;
  if (reply.status !== COMPLETED) {
    const why = scrub(reply.errors?.map((error) => error.message ?? '').join(' ') ?? '', settings);
    throw new EngineRunError(
      'failed',
      `Gemini did not finish (status ${scrub(reply.status ?? 'unknown', settings)})${why ? `: ${why}` : ''}`,
    );
  }
  const step = reply.steps?.findLast((candidate) => candidate.type === ANSWER_STEP);
  const text = (step?.content ?? []).map((part) => part.text ?? '').join('');
  if (text === '') throw new EngineRunError('failed', 'Gemini gave no answer.');
  return { text, turns: null };
}

function requestFailure(error: unknown, closing: boolean): EngineRunError {
  if (closing) return new EngineRunError('failed', 'Gemini was stopped because Jgtube is closing.');
  const name = error instanceof Error ? error.name : '';
  return name === 'TimeoutError'
    ? new EngineRunError('timeout', 'Gemini took too long and was stopped. Try again.')
    : new EngineRunError(
        'failed',
        'Google could not be reached to watch the video. Check the connection and try again.',
      );
}

/** One question to the Interactions API. Rejects with an EngineRunError. */
async function interact(
  input: readonly Part[],
  systemPrompt: string | null,
  timeoutMs: number,
  settings: GeminiSettings,
  deps: GeminiDeps,
): Promise<EngineRunResult> {
  const limit = AbortSignal.timeout(timeoutMs);
  const signal = deps.signal ? AbortSignal.any([limit, deps.signal]) : limit;
  let response: Response;
  let body: string;
  try {
    response = await (deps.fetch ?? (fetch as GeminiFetch))(GEMINI_ENDPOINT, {
      method: 'POST',
      headers: { [KEY_HEADER]: settings.apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: settings.model,
        input,
        ...(systemPrompt === null ? {} : { system_instruction: systemPrompt }),
        store: false,
      }),
      signal,
      // The key must never follow a redirect to another address.
      redirect: 'error',
    });
    body = await response.text();
  } catch (error) {
    throw requestFailure(error, deps.signal?.aborted === true);
  }
  if (!response.ok) throw refusal(response.status, body, settings);
  return answerOf(body, settings);
}

/** Has Gemini watch one public YouTube video. Rejects with an EngineRunError. */
export function watchWithGemini(
  request: GeminiVideoRequest,
  settings: GeminiSettings,
  deps: GeminiDeps = {},
): Promise<EngineRunResult> {
  if (!isVideoId(request.videoId)) {
    return Promise.reject(new EngineRunError('failed', NOT_A_VIDEO_ID));
  }
  // The link is built here from the checked id; nothing typed reaches Google as an address.
  const uri = videoLink(request.videoId);
  return interact(
    [
      { type: 'text', text: request.question },
      { type: 'video', uri },
    ],
    request.systemPrompt,
    request.timeoutMs,
    settings,
    deps,
  );
}

/** One question in words only: proves the key works without watching anything. */
export const askGemini = (
  question: string,
  settings: GeminiSettings,
  deps: GeminiDeps = {},
): Promise<EngineRunResult> =>
  interact([{ type: 'text', text: question }], null, ASK_TIMEOUT_MS, settings, deps);
