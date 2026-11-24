import { Maximize2, Sparkles, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { aiBadge } from '../../lib/aiBadge';
import { askPlaceholder, starterFor, type AskContext } from '../../lib/askContext';
import { viewHref } from '../../lib/routes';
import { AskAnswers, AskHow } from '../AskClaude';
import { AskInput, QuickQuestions } from '../AskBox';
import { Button, IconButton } from '../ui/Button';
import { Avatar } from '../ui/Row';
import { EmptyState } from '../ui/States';
import type { AskSession } from '../useAskSession';

interface Props {
  readonly session: AskSession;
  /** What the screen under the panel is about; null before any map. */
  readonly context: AskContext | null;
  readonly onClose: () => void;
}

/** The channel the answers are about, and how much stored data stands behind it. */
function About({ context }: { readonly context: AskContext }) {
  const { about, scope } = context;
  return (
    <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-line bg-white/[0.02] px-4 py-3 text-body-sm text-muted sm:px-5">
      About
      <span className="inline-flex min-w-0 items-center gap-1.5 rounded-md border border-line-2 bg-white/[0.07] py-0.5 pl-1 pr-2 font-semibold text-ink">
        <Avatar title={about.title} logoUrl={about.logoUrl} size="xs" />
        <span className="truncate">{about.title}</span>
      </span>
      {scope}
    </p>
  );
}

/** Closes on Escape, and puts the cursor in the question box when the panel opens. */
function usePanelKeys(onClose: () => void) {
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    const escape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', escape);
    panel.current?.querySelector<HTMLInputElement>('input')?.focus();
    return () => document.removeEventListener('keydown', escape);
  }, [onClose]);
  return panel;
}

/**
 * Ask, on every screen: a panel that slides over whatever is open, says
 * which channel the answers are about, shows the last answer, and takes a
 * question at its foot. A sheet from the bottom on a phone. "Open large"
 * carries the same conversation to a full page.
 */
export function AskPanel({ session, context, onClose }: Props) {
  const panel = usePanelKeys(onClose);
  const { analysis, busy } = session;
  const badge = aiBadge(analysis.choice, analysis.engines);
  const subject = context?.subject ?? null;
  return (
    <>
      <div
        aria-hidden="true"
        onClick={onClose}
        className="fixed inset-0 z-[70] bg-ground/60 backdrop-blur-[2px]"
      />
      <aside
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label="Ask"
        className="fixed inset-x-0 bottom-0 top-10 z-[80] flex flex-col rounded-t-xl border border-line bg-ground-2 shadow-2xl sm:inset-y-0 sm:left-auto sm:right-0 sm:w-[480px] sm:rounded-none sm:border-y-0 sm:border-r-0"
      >
        <header className="flex flex-none items-center gap-2.5 border-b border-line px-4 py-3 sm:px-5">
          <Sparkles aria-hidden="true" className="h-5 w-5 flex-none text-signal" />
          <h2 className="text-headline-md text-ink">Ask</h2>
          <a
            href={viewHref('settings')}
            onClick={onClose}
            title="Choose which AI answers, in Settings"
            className="min-w-0 truncate text-body-sm text-muted hover:text-link"
          >
            {badge.name} answers{badge.ready ? '' : ' · not ready'}
          </a>
          <span className="ml-auto flex flex-none items-center">
            <IconButton
              icon={Maximize2}
              label="Open large"
              href={viewHref('ask')}
              onClick={onClose}
            />
            <IconButton icon={X} label="Close Ask" onClick={onClose} />
          </span>
        </header>
        {context ? (
          <>
            <About context={context} />
            <div className="flex min-h-0 flex-1 flex-col gap-space-md overflow-y-auto px-4 py-4 sm:px-5">
              <AskAnswers session={session} />
              <AskHow />
            </div>
            <div className="flex flex-none flex-col gap-2.5 border-t border-line px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 sm:px-5">
              <QuickQuestions busy={busy} onQuick={session.quick} oneRow />
              <AskInput
                id="ask-panel-question"
                busy={busy}
                onAsk={session.ask}
                placeholder={askPlaceholder(context)}
                starter={
                  subject && { label: `Ask about ${subject.title}`, text: starterFor(subject) }
                }
              />
            </div>
          </>
        ) : (
          <div className="p-4 sm:p-5">
            <EmptyState
              icon={Sparkles}
              title="Ask needs a channel first"
              line="Add your channel on Today. The AI answers from what Jgtube has stored about it."
              action={
                <Button kind="main" href={viewHref('home')} onClick={onClose}>
                  Go to Today
                </Button>
              }
            />
          </div>
        )}
      </aside>
    </>
  );
}
