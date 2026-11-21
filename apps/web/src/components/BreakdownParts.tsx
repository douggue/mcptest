import { ChevronRight, Copy, Download } from 'lucide-react';
import { useState } from 'react';
import {
  attachmentOf,
  copyFailedText,
  hasGaps,
  partNote,
  savedLine,
  textUrl,
  writtenLine,
  type BreakdownPartView,
  type BreakdownView,
  type PartAttachment,
} from '../lib/breakdownParts';
import { Answer } from './Answer';
import type { BreakdownChannel } from './useBreakdown';

const BUTTON =
  'self-start rounded-full bg-on-surface px-4 py-1.5 text-body-sm font-semibold text-space-deep transition-all hover:bg-white disabled:cursor-not-allowed disabled:opacity-60';
const SMALL_BUTTON =
  'flex flex-none items-center gap-1.5 rounded-full bg-surface-container-high px-3 py-2 text-label-caps text-on-surface transition-colors hover:bg-surface-variant disabled:cursor-not-allowed disabled:opacity-60';

interface ActionsProps {
  readonly channelId: string;
  readonly attachment: PartAttachment;
}

/** Copy a text to the clipboard, and save it as a .txt file. */
function Actions({ channelId, attachment }: ActionsProps) {
  const [said, setSaid] = useState('');
  const { text, file, label } = attachment;
  const copy = () => {
    if (text === null) return;
    // A browser may have no clipboard to write to, or may refuse: both are said, not thrown.
    Promise.resolve()
      .then(() => navigator.clipboard.writeText(text))
      .then(
        () => setSaid('Copied.'),
        () => setSaid(copyFailedText(label)),
      );
  };
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={copy}
        disabled={text === null}
        aria-label={`Copy the ${label}`}
        className={SMALL_BUTTON}
      >
        <Copy aria-hidden="true" className="h-3.5 w-3.5" />
        Copy
      </button>
      {file?.available && (
        <a
          href={textUrl(channelId, file.name)}
          download={file.name}
          aria-label={`Download the ${label} as a text file`}
          className={SMALL_BUTTON}
        >
          <Download aria-hidden="true" className="h-3.5 w-3.5" />
          Download .txt
        </a>
      )}
      <span role="status" className="min-w-0 break-words text-body-sm text-outline">
        {said}
      </span>
    </div>
  );
}

/** A ready prompt as it stands, to read, copy and download; or why there is none. */
function PromptBox({ channelId, attachment }: ActionsProps) {
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded bg-space-deep p-space-md">
      <h4 className="text-label-caps uppercase text-primary">The {attachment.label}</h4>
      {attachment.text === null ? (
        <p className="break-words text-body-sm text-error">{attachment.problem}</p>
      ) : (
        <p className="whitespace-pre-wrap break-words text-body-md text-on-surface">
          {attachment.text}
        </p>
      )}
      <Actions channelId={channelId} attachment={attachment} />
    </div>
  );
}

interface PartProps {
  readonly view: BreakdownView;
  readonly part: BreakdownPartView;
}

/** One part, closed until it is opened: its title, who wrote it, then its text. */
function Part({ view, part }: PartProps) {
  const attachment = attachmentOf(view, part.id);
  const written = part.state === 'written';
  return (
    <details className="group min-w-0 rounded bg-surface-card shadow-md">
      <summary className="flex cursor-pointer list-none items-center gap-space-sm rounded p-space-md focus:outline-none focus-visible:ring-1 focus-visible:ring-primary-container [&::-webkit-details-marker]:hidden">
        <ChevronRight
          aria-hidden="true"
          className="h-4 w-4 flex-none text-outline transition-transform group-open:rotate-90"
        />
        <span className="flex min-w-0 flex-col">
          <span className="text-title-md text-on-surface">{part.title}</span>
          <span className={`break-words text-body-sm ${written ? 'text-outline' : 'text-error'}`}>
            {partNote(part)}
          </span>
        </span>
      </summary>
      {written && (
        <div className="flex min-w-0 flex-col gap-space-sm pb-space-md">
          {attachment?.inBody && (
            <div className="px-space-lg">
              <Actions channelId={view.channel.id} attachment={attachment} />
            </div>
          )}
          {part.body !== '' && <Answer text={part.body} />}
          {attachment && !attachment.inBody && (
            <div className="px-space-lg">
              <PromptBox channelId={view.channel.id} attachment={attachment} />
            </div>
          )}
        </div>
      )}
    </details>
  );
}

interface Props {
  readonly view: BreakdownView;
  /** Why the text files were not saved in the run just finished; null otherwise. */
  readonly notSaved: string | null;
  /** Something is running, so nothing new can start. */
  readonly busy: boolean;
  /** Runs the breakdown of this channel again; `fresh` studies and writes everything again. */
  readonly onRun: (channel: BreakdownChannel, fresh: boolean) => void;
}

/**
 * A stored breakdown: when it was written, the control to run it again, its
 * parts as sections that open, and where its text files are.
 */
export function BreakdownParts({ view, notSaved, busy, onRun }: Props) {
  const { channel } = view;
  const whole = view.files.find((file) => file.id === 'whole');
  return (
    <div className="flex min-w-0 flex-col gap-space-sm">
      <div className="flex min-w-0 flex-col gap-2">
        <h3 className="break-words text-title-md text-on-surface">
          Channel breakdown: {channel.title}
        </h3>
        <p className="text-body-sm text-on-surface-variant">{writtenLine(view)}</p>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onRun(channel, true)}
            disabled={busy}
            className={BUTTON}
          >
            Run again
          </button>
          {hasGaps(view) && (
            <button
              type="button"
              onClick={() => onRun(channel, false)}
              disabled={busy}
              className={SMALL_BUTTON}
            >
              Write the missing parts
            </button>
          )}
          {whole?.available && (
            <a
              href={textUrl(channel.id, whole.name)}
              download={whole.name}
              className={SMALL_BUTTON}
            >
              <Download aria-hidden="true" className="h-3.5 w-3.5" />
              Download the whole breakdown
            </a>
          )}
        </div>
        <p className="text-body-sm text-outline">
          “Run again” studies the videos and writes every part again, which takes as long as the
          first time. Check every fact in it before you publish: an AI wrote these parts, and it can
          be wrong.
        </p>
      </div>
      {view.parts.map((part) => (
        <Part key={part.id} view={view} part={part} />
      ))}
      <p className="break-words text-body-sm text-outline">{savedLine(view, notSaved)}</p>
    </div>
  );
}
