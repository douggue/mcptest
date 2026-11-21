import { Copy, Download } from 'lucide-react';
import { useState } from 'react';
import { copyFailedText } from '../lib/breakdownParts';
import { exportName } from '../lib/scriptWriter';
import type { NamedVideo } from '../lib/videoRefs';
import { VideoChips } from './VideoChips';

const SMALL_BUTTON =
  'flex flex-none items-center gap-1.5 rounded-full bg-surface-container-high px-3 py-2 text-label text-on-surface transition-colors hover:bg-surface-variant focus:outline-none focus-visible:ring-1 focus-visible:ring-primary-container';

/** Hands the browser a text file to save. */
export function saveText(name: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

interface Props {
  /** What it is called in a sentence: "thumbnail prompt". */
  readonly label: string;
  readonly text: string;
  /** The name the .txt file is saved under, without its extension. */
  readonly fileTitle: string;
  /** The thumbnails it was learned from, shown with it; none to show none. */
  readonly learnedFrom?: readonly NamedVideo[];
  /** One quiet line under the prompt, such as why this style. */
  readonly note?: string;
}

/**
 * A ready prompt in its own box, as written, to copy or save as a .txt
 * file; with the thumbnails it was learned from when there are any.
 */
export function ReadyPrompt({ label, text, fileTitle, learnedFrom = [], note }: Props) {
  const [said, setSaid] = useState('');
  const copy = (): void => {
    // A browser may have no clipboard to write to, or may refuse: both are said, not thrown.
    Promise.resolve()
      .then(() => navigator.clipboard.writeText(text))
      .then(
        () => setSaid('Copied.'),
        () => setSaid(copyFailedText(label)),
      );
  };
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded border border-outline-variant bg-space-deep p-space-md">
      <h4 className="text-label text-primary">The {label}</h4>
      <p className="whitespace-pre-wrap break-words text-body-md text-on-surface">{text}</p>
      {note !== undefined && note !== '' && (
        <p className="break-words text-body-sm text-on-surface-variant">{note}</p>
      )}
      {learnedFrom.length > 0 && (
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-label text-outline">Learned from</span>
          <VideoChips videos={learnedFrom} />
        </div>
      )}
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <button type="button" onClick={copy} className={SMALL_BUTTON}>
          <Copy aria-hidden="true" className="h-3.5 w-3.5" />
          Copy
        </button>
        <button
          type="button"
          onClick={() => saveText(exportName(fileTitle, 'txt'), `${text.trim()}\n`)}
          className={SMALL_BUTTON}
        >
          <Download aria-hidden="true" className="h-3.5 w-3.5" />
          Download .txt
        </button>
        <span role="status" className="min-w-0 break-words text-body-sm text-outline">
          {said}
        </span>
      </div>
    </div>
  );
}
