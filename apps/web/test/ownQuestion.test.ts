import { describe, expect, test } from 'vitest';
import { AUTOMATIC } from '../src/lib/analyses';
import { askBlocked, createOwnQuestionApi, MAX_QUESTION_CHARS } from '../src/lib/ownQuestion';

const CHANNEL = 'UCaaaaaaaaaaaaaaaaaaaaaa';
const ANSWER = {
  question: 'Why?',
  text: 'Because.',
  engine: 'claude',
  writtenAt: '2026-11-22T10:00:00.000Z',
};

function replying(data: unknown, asked: Array<[string, string | null]> = []) {
  return createOwnQuestionApi(async (url, init) => {
    asked.push([String(url), typeof init?.body === 'string' ? init.body : null]);
    return new Response(JSON.stringify({ success: true, data, error: null }));
  });
}

describe('your own question', () => {
  test('is sent trimmed, with the engine only when one was chosen', async () => {
    const asked: Array<[string, string | null]> = [];
    const api = replying(ANSWER, asked);

    expect(await api.ask(CHANNEL, '  Why?  ', AUTOMATIC)).toEqual(ANSWER);
    await api.ask(CHANNEL, 'Why?', 'claude');

    expect(asked.map(([, body]) => (body ? JSON.parse(body) : null))).toEqual([
      { channel: CHANNEL, question: 'Why?' },
      { channel: CHANNEL, question: 'Why?', engine: 'claude' },
    ]);
    expect(asked[0]?.[0]).toBe('/api/analyses/question');
  });

  test('reads back the last question and answer kept for the channel', async () => {
    const asked: Array<[string, string | null]> = [];

    expect(await replying({ answer: ANSWER }, asked).kept(CHANNEL)).toEqual(ANSWER);
    expect(await replying({ answer: null }).kept(CHANNEL)).toBeNull();
    expect(asked[0]?.[0]).toBe(`/api/analyses/question?channel=${CHANNEL}`);
  });

  test('says why it cannot be sent, as the server would refuse it', () => {
    expect(askBlocked('Why?', false)).toBeNull();
    expect(askBlocked('', false)).toBeNull();
    expect(askBlocked('Why?', true)).toBe('Waits for the AI run under way to finish.');
    expect(askBlocked('a\nb', false)).toBe('Keep it to one line of plain text.');
    expect(askBlocked('a'.repeat(MAX_QUESTION_CHARS + 1), false)).toBe(
      `At most ${MAX_QUESTION_CHARS} characters.`,
    );
  });
});
