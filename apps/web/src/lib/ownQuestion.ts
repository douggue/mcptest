import { AUTOMATIC, type EngineChoice } from './analyses';
import { apiCaller, type Fetch } from './api';
import type { AskAbout } from './askContext';

/**
 * The owner's own question in Ask AI: one line, sent to the server as data,
 * and the answer kept with it per channel.
 */

/** The longest question the server takes. */
export const MAX_QUESTION_CHARS = 300;
const PATH = '/api/analyses/question';
/** Line breaks, control characters and the invisible marks the server refuses. */
const NOT_ONE_LINE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/;

/** A question and the answer kept with it. */
export interface OwnAnswer {
  readonly question: string | null;
  readonly text: string;
  readonly engine: string;
  readonly writtenAt: string | null;
}

/** Why the box cannot be sent yet, in one line, or null when it can. Mirrors the server's check. */
export function askBlocked(question: string, busy: boolean): string | null {
  if (busy) return 'Waits for the AI run under way to finish.';
  if (question.trim() === '') return null;
  if (NOT_ONE_LINE.test(question)) return 'Keep it to one line of plain text.';
  return question.length > MAX_QUESTION_CHARS ? `At most ${MAX_QUESTION_CHARS} characters.` : null;
}

export function createOwnQuestionApi(fetcher?: Fetch) {
  const { call, unwrap, send } = apiCaller(fetcher);
  return {
    /** Asks the question about the channel and waits for the kept answer. */
    async ask(
      channel: string,
      question: string,
      choice: EngineChoice,
      about?: AskAbout,
    ): Promise<OwnAnswer> {
      const body = {
        channel,
        question: question.trim(),
        ...(choice === AUTOMATIC ? {} : { engine: choice }),
        // The channel or video on screen while asking, by its id.
        ...(about ? { about } : {}),
      };
      return unwrap<OwnAnswer>(await send(PATH, body));
    },

    /** The last question asked about the channel and its answer; null when none. */
    async kept(channel: string): Promise<OwnAnswer | null> {
      const query = new URLSearchParams({ channel });
      return unwrap<{ answer: OwnAnswer | null }>(await call(`${PATH}?${query.toString()}`)).answer;
    },
  };
}

export type OwnQuestionApi = ReturnType<typeof createOwnQuestionApi>;
