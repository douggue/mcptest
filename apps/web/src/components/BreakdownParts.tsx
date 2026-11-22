import { Copy, Download } from 'lucide-react';
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
import { partFixes, type PartsRun } from '../lib/partFixes';
import type { NamedVideo } from '../lib/videoRefs';
import { leadOf } from '../lib/longAnswer';
import { BreakdownUses } from './BreakdownUses';
import { Card, Label } from './layout/Card';
import { Details } from './layout/Details';
import { ViewHeader } from './layout/ViewHeader';
import { QUIET_BUTTON } from './LabStatus';
import { LongAnswer } from './LongAnswer';
import { useNamedVideos } from './useAnswers';
import type { BreakdownChannel } from './useBreakdown';

const SMALL_BUTTON =
  'flex flex-none items-center gap-1.5 rounded-full bg-surface-container-high px-3 py-2 text-label text-on-surface transition-colors hover:bg-surface-variant disabled:cursor-not-allowed disabled:opacity-60';

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
    <div className="flex min-w-0 flex-col gap-2 rounded-lg border border-border-subtle bg-space-deep p-space-md">
      <Label>The {attachment.label}</Label>
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
  /** The stored videos the parts name, shown as thumbnails beside the points. */
  readonly videos: readonly NamedVideo[];
}

interface FixProps {
  readonly part: BreakdownPartView;
  readonly busy: boolean;
  /** Writes chosen parts alone again, from what is stored. */
  readonly onWrite: (only: PartsRun) => void;
}

/** A warning about how a part was written, and the one press that writes it again. */
function PartFix({ part, busy, onWrite }: FixProps) {
  const { warning, action } = partFixes(part);
  if (warning === null && action === null) return null;
  return (
    <div className="flex min-w-0 flex-col gap-2">
      {warning && <p className="break-words text-body-sm text-metric-amber">{warning}</p>}
      {action && (
        <button
          type="button"
          disabled={busy}
          onClick={() => onWrite({ parts: action.parts, avoid: action.avoid })}
          className={`self-start ${QUIET_BUTTON}`}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

/** What a written part holds, behind its disclosure: copy and download, its sections, its prompt. */
function PartBody({ view, part, videos }: PartProps) {
  const attachment = attachmentOf(view, part.id);
  return (
    <>
      {attachment?.inBody && <Actions channelId={view.channel.id} attachment={attachment} />}
      {part.body !== '' && <LongAnswer text={part.body} videos={videos} leadShown />}
      {attachment && !attachment.inBody && (
        <PromptBox channelId={view.channel.id} attachment={attachment} />
      )}
    </>
  );
}

/** One part on a card: its title, who wrote it, its opening line, and the rest closed until opened. */
function Part(props: PartProps & Omit<FixProps, 'part'>) {
  const { part, busy, onWrite } = props;
  const written = part.state === 'written';
  const lead = written ? leadOf(part.body) : null;
  return (
    <Card as="li">
      <div className="flex min-w-0 flex-col gap-0.5">
        <h3 className="break-words text-title-md font-semibold text-on-surface">{part.title}</h3>
        <p className={`break-words text-body-sm ${written ? 'text-outline' : 'text-error'}`}>
          {partNote(part)}
        </p>
      </div>
      <PartFix part={part} busy={busy} onWrite={onWrite} />
      {lead !== null && (
        <p className="line-clamp-3 break-words text-body-md text-on-surface-variant">{lead}</p>
      )}
      {written && (
        <Details summary="Read the part">
          <PartBody {...props} />
        </Details>
      )}
    </Card>
  );
}

interface Props {
  readonly view: BreakdownView;
  /** Why the text files were not saved in the run just finished; null otherwise. */
  readonly notSaved: string | null;
  /** Something is running, so nothing new can start. */
  readonly busy: boolean;
  /**
   * Runs the breakdown of this channel again; `fresh` studies and writes
   * everything again; `only` writes chosen parts alone, from what is stored.
   */
  readonly onRun: (channel: BreakdownChannel, fresh: boolean, only?: PartsRun) => void;
}

/** The quiet buttons at the top of a breakdown: run it again, fill its gaps, download it whole. */
function HeaderActions({ view, busy, onRun }: Omit<Props, 'notSaved'>) {
  const { channel } = view;
  const whole = view.files.find((file) => file.id === 'whole');
  return (
    <>
      <button
        type="button"
        onClick={() => onRun(channel, true)}
        disabled={busy}
        className={QUIET_BUTTON}
      >
        Run again
      </button>
      {hasGaps(view) && (
        <button
          type="button"
          onClick={() => onRun(channel, false)}
          disabled={busy}
          className={QUIET_BUTTON}
        >
          Write the missing parts
        </button>
      )}
      {whole?.available && (
        <a
          href={textUrl(channel.id, whole.name)}
          download={whole.name}
          className={`flex items-center gap-1.5 ${QUIET_BUTTON}`}
        >
          <Download aria-hidden="true" className="h-4 w-4" />
          Download the whole breakdown
        </a>
      )}
    </>
  );
}

/**
 * A stored breakdown: when it was written and the quiet controls to run it
 * again, where it can be used, then each part as a card with its opening
 * line, the rest behind "Read the part".
 */
export function BreakdownParts({ view, notSaved, busy, onRun }: Props) {
  const { channel } = view;
  // The channel broken down may be on no map; its own stored videos are looked up with it.
  const videos = useNamedVideos(
    channel.id,
    view.parts.map((part) => part.body).join('\n'),
    channel.id,
  );
  return (
    <div className="flex min-w-0 flex-col gap-space-lg">
      <ViewHeader
        title={`Channel breakdown: ${channel.title}`}
        lead={writtenLine(view)}
        actions={<HeaderActions view={view} busy={busy} onRun={onRun} />}
      />
      <p className="text-body-sm text-metric-amber">
        An AI wrote these parts and can be wrong: check every fact before you publish.
      </p>
      <Card>
        <Label>Use this breakdown</Label>
        <BreakdownUses view={view} />
        <Details summary="How this works">
          <p className="text-body-sm text-on-surface-variant">
            &ldquo;Run again&rdquo; studies the videos and writes every part again, which takes as
            long as the first time.
          </p>
          <p className="break-words text-body-sm text-on-surface-variant">
            {savedLine(view, notSaved)}
          </p>
        </Details>
      </Card>
      <ol className="flex min-w-0 flex-col gap-space-md">
        {view.parts.map((part) => (
          <Part
            key={part.id}
            view={view}
            part={part}
            videos={videos}
            busy={busy}
            onWrite={(only) => onRun(channel, false, only)}
          />
        ))}
      </ol>
    </div>
  );
}
