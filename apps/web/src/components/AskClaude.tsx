import type { AskContext } from '../lib/askContext';
import { AskBody, AskHead } from './shell/AskPanel';
import type { AskSession } from './useAskSession';

interface Props {
  readonly session: AskSession;
  /** What Ask was about on the screen it was opened large from; null before any map. */
  readonly context: AskContext | null;
  /** Goes back to that screen with the panel open. */
  readonly onShrink: () => void;
}

/**
 * Ask, opened large: the same conversation as the panel, laid out the same
 * way on a page of its own, with the way back to the panel where the panel
 * has "Open large". (The component keeps its first name.)
 */
export function AskClaude({ session, context, onShrink }: Props) {
  return (
    <section
      id="ask-claude"
      aria-label="Ask"
      className="mx-auto flex w-full max-w-3xl min-w-0 px-4 py-5 sm:px-8 sm:py-7"
    >
      <div className="flex h-[calc(100vh-12.5rem)] min-h-[26rem] w-full min-w-0 flex-col overflow-hidden rounded-lg border border-line bg-ground-2 md:h-[calc(100vh-9rem)]">
        <AskHead session={session} large onResize={onShrink} />
        <AskBody session={session} context={context} inputId="own-question" />
      </div>
    </section>
  );
}
