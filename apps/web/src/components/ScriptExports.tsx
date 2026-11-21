import { ClipboardCopy, Download } from 'lucide-react';
import { useState } from 'react';
import {
  exportMarkdown,
  exportName,
  exportShotList,
  exportText,
  voiceoverCopy,
} from '../lib/scriptWriter';
import { QUIET_BUTTON } from './LabStatus';

const LABEL = 'text-label text-outline';
/** How long "Copied" stays on the button. */
const COPIED_MS = 2500;

/** Hands the browser a file to save. */
function download(name: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

interface ExportProps {
  readonly title: string;
  readonly text: string;
  readonly wordsPerMinute: number | null;
  /** False when the owner has turned the marking of facts off. */
  readonly markFacts: boolean;
  /** The concept's thumbnail prompt, carried at the end of the Markdown file; null when none. */
  readonly thumbnailPrompt: string | null;
  readonly sources: readonly string[];
}

/**
 * The three ways out: the clean voiceover to the clipboard, the whole script
 * as a text or Markdown file, and the shot list as a CSV file. The voiceover
 * leaves the check markers out, so it is never copied silently while facts
 * are still unchecked: the first press says how many, the second copies.
 */
export function Exports({
  title,
  text,
  wordsPerMinute,
  markFacts,
  thumbnailPrompt,
  sources,
}: ExportProps) {
  const [copy, setCopy] = useState<'idle' | 'warned' | 'copied' | 'refused'>('idle');
  const voiceover = voiceoverCopy(text, markFacts);
  const empty = text.trim() === '';
  const copyVoiceover = (): void => {
    if (voiceover.unchecked > 0 && copy !== 'warned') {
      setCopy('warned');
      return;
    }
    navigator.clipboard
      .writeText(voiceover.text)
      .then(() => setCopy('copied'))
      .catch(() => setCopy('refused'))
      .finally(() => window.setTimeout(() => setCopy('idle'), COPIED_MS));
  };
  const ICON = 'h-4 w-4';
  return (
    <div className="flex flex-col gap-2">
      <span className={LABEL}>Export</span>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={empty}
          onClick={copyVoiceover}
          className={`flex items-center gap-1.5 ${QUIET_BUTTON}`}
        >
          <ClipboardCopy aria-hidden="true" className={ICON} />
          <span aria-live="polite">
            {copy === 'warned'
              ? 'Copy anyway'
              : copy === 'copied'
                ? 'Copied'
                : copy === 'refused'
                  ? 'Could not copy'
                  : 'Copy clean voiceover text'}
          </span>
        </button>
        <button
          type="button"
          disabled={empty}
          onClick={() =>
            download(exportName(title, 'txt'), exportText(title, text, markFacts), 'text/plain')
          }
          className={`flex items-center gap-1.5 ${QUIET_BUTTON}`}
        >
          <Download aria-hidden="true" className={ICON} />
          Text file (.txt)
        </button>
        <button
          type="button"
          disabled={empty}
          onClick={() =>
            download(
              exportName(title, 'md'),
              exportMarkdown(title, text, markFacts, { thumbnailPrompt, sources }),
              'text/markdown',
            )
          }
          className={`flex items-center gap-1.5 ${QUIET_BUTTON}`}
        >
          <Download aria-hidden="true" className={ICON} />
          Markdown file (.md)
        </button>
        <button
          type="button"
          disabled={empty || wordsPerMinute === null}
          onClick={() =>
            download(exportName(title, 'csv'), exportShotList(text, wordsPerMinute), 'text/csv')
          }
          className={`flex items-center gap-1.5 ${QUIET_BUTTON}`}
        >
          <Download aria-hidden="true" className={ICON} />
          B-roll shot list (.csv)
        </button>
      </div>
      {copy === 'warned' && (
        <p role="alert" className="text-body-sm text-metric-amber">
          {voiceover.unchecked} {voiceover.unchecked === 1 ? 'fact is' : 'facts are'} still marked
          to be checked. The clean text leaves the markers out and keeps the claims. Check them
          first, or press Copy anyway.
        </p>
      )}
      <p className="text-body-sm text-outline">
        The clean voiceover is only what is spoken. The text and Markdown files carry the headings
        and the picture cues{markFacts ? ', and every check marker' : ''}. The shot list has one row
        per picture cue, with times worked out from the words at the speaking rate.
      </p>
    </div>
  );
}
