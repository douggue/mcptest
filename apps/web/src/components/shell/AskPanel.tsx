import { Maximize2, Minimize2, Sparkles, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { aiBadge, answersLine } from '../../lib/aiBadge';
import {
  askAbout,
  askPlaceholder,
  quickLabel,
  type AskChip,
  type AskContext,
} from '../../lib/askContext';
import { thumbnailUrl } from '../../lib/format';
import { viewHref } from '../../lib/routes';
import { AskAnswers, AskHow } from '../AskAnswers';
import { AskInput, QuickQuestions } from '../AskBox';
import { Button, IconButton } from '../ui/Button';
import { Avatar } from '../ui/Row';
import { EmptyState } from '../ui/States';
import type { AskSession } from '../useAskSession';

/** What the chip shows before the name: a channel's logo, or a video's thumbnail. */
function ChipPicture({ chip }: { readonly chip: AskChip }) {
  if (chip.kind !== 'video') return <Avatar title={chip.title} logoUrl={chip.logoUrl} size="xs" />;
  const picture = thumbnailUrl(chip.id);
  return (
    <span className="h-[18px] w-8 flex-none overflow-hidden rounded border border-white/15 bg-card-2">
      {picture && (
        <img
          src={picture}
          alt=""
          referrerPolicy="no-referrer"
          className="h-full w-full object-cover"
        />
      )}
    </span>
  );
}

/** What the answers are about on this screen, and what the AI reads to give them. */
function About({ context }: { readonly context: AskContext }) {
  const { chip, reads, cannot } = context;
  return (
    <div className="flex min-w-0 flex-col gap-1 border-b border-line bg-white/[0.02] px-4 py-3 text-body-sm text-muted sm:px-5">
      <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        About
        <span className="inline-flex min-w-0 items-center gap-1.5 rounded-md border border-line-2 bg-white/[0.07] py-0.5 pl-1 pr-2 font-semibold text-ink">
          <ChipPicture chip={chip} />
          <span className="truncate">{chip.title}</span>
        </span>
        {reads}
      </p>
      {cannot && <p className="text-dim">{cannot}</p>}
    </div>
  );
}

interface BodyProps {
  readonly session: AskSession;
  readonly context: AskContext | null;
  /** The question box's id; the panel and the large view each have their own. */
  readonly inputId: string;
  /** Where the "Go to Today" of the empty state leads from: closes a panel first. */
  readonly onLeave?: () => void;
}

/**
 * Ask itself, the same in the panel and opened large: what it is about, the
 * last answer, then the question box with the quick questions under it.
 */
export function AskBody({ session, context, inputId, onLeave }: BodyProps) {
  const { busy } = session;
  if (!context) {
    return (
      <div className="p-4 sm:p-5">
        <EmptyState
          icon={Sparkles}
          title="Ask needs your channel first"
          line="Add your channel on Today. The AI answers from what Jgtube has stored about it."
          action={
            <Button kind="main" href={viewHref('home')} onClick={onLeave}>
              Go to Today
            </Button>
          }
        />
      </div>
    );
  }
  const label = quickLabel(context);
  return (
    <>
      <About context={context} />
      <div className="flex min-h-0 flex-1 flex-col gap-space-md overflow-y-auto px-4 py-4 sm:px-5">
        <AskAnswers session={session} />
        <AskHow />
      </div>
      <div className="flex flex-none flex-col gap-2.5 border-t border-line px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 sm:px-5">
        <AskInput
          id={inputId}
          busy={busy}
          onAsk={(question) => session.ask(question, askAbout(context))}
          placeholder={askPlaceholder(context)}
        />
        {label && <p className="text-body-sm text-dim">{label}</p>}
        <QuickQuestions busy={busy} onQuick={session.quick} oneRow />
      </div>
    </>
  );
}

interface HeadProps {
  readonly session: AskSession;
  /** Opened large: the title is the page's, and the icon shrinks it back to the panel. */
  readonly large: boolean;
  /** Opens it large from the panel, or shrinks it back to the panel. */
  readonly onResize: () => void;
  /** Closes the panel; absent on the large view, which has no panel to close. */
  readonly onClose?: () => void;
}

/** The top of Ask: its name, which AI answers, and the way to make it large or small. */
export function AskHead({ session, large, onResize, onClose }: HeadProps) {
  const { analysis } = session;
  const badge = aiBadge(analysis.choice, analysis.engines);
  const Title = large ? 'h1' : 'h2';
  return (
    <header className="flex flex-none items-center gap-2.5 border-b border-line px-4 py-3 sm:px-5">
      <Sparkles aria-hidden="true" className="h-5 w-5 flex-none text-signal" />
      <Title className={large ? 'text-headline-lg text-ink' : 'text-headline-md text-ink'}>
        Ask
      </Title>
      <a
        href={viewHref('settings')}
        onClick={onClose}
        title="Choose which AI answers, in Settings"
        className="min-w-0 truncate text-body-sm text-muted hover:text-link"
      >
        {answersLine(badge)}
      </a>
      <span className="ml-auto flex flex-none items-center">
        <IconButton
          icon={large ? Minimize2 : Maximize2}
          label={large ? 'Back to the panel' : 'Open large'}
          onClick={onResize}
        />
        {onClose && <IconButton icon={X} label="Close Ask" onClick={onClose} />}
      </span>
    </header>
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

interface Props {
  readonly session: AskSession;
  /** What the screen under the panel is about; null before any map. */
  readonly context: AskContext | null;
  readonly onClose: () => void;
  /** Opens the same conversation as a page of its own. */
  readonly onLarge: () => void;
}

/**
 * Ask, on every screen: a panel that slides over whatever is open, says
 * what the answers are about, shows the last answer, and takes a question
 * at its foot. A sheet from the bottom on a phone. "Open large" carries the
 * same conversation to a full page.
 */
export function AskPanel({ session, context, onClose, onLarge }: Props) {
  const panel = usePanelKeys(onClose);
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
        <AskHead session={session} large={false} onResize={onLarge} onClose={onClose} />
        <AskBody
          session={session}
          context={context}
          inputId="ask-panel-question"
          onLeave={onClose}
        />
      </aside>
    </>
  );
}
