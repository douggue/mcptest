import { ChevronRight, Image } from 'lucide-react';
import type { ConceptThumbnailView } from '../lib/ideaLab';
import { QUIET_BUTTON } from './LabStatus';
import { ReadyPrompt } from './ReadyPrompt';

interface Props {
  readonly title: string;
  readonly thumbnail: ConceptThumbnailView | null;
  readonly busy: boolean;
  /** Asks for the prompt; absent where it cannot be asked for, such as the script writer. */
  readonly onWrite?: (() => void) | undefined;
}

/**
 * A concept's thumbnail prompt: the button that asks for it, or the prompt
 * with the winning thumbnails it was learned from, to copy or save.
 */
export function ConceptThumbnail({ title, thumbnail, busy, onWrite }: Props) {
  const button = onWrite && (
    <button
      type="button"
      disabled={busy}
      onClick={onWrite}
      className={`flex items-center gap-1.5 self-start ${QUIET_BUTTON}`}
    >
      <Image aria-hidden="true" className="h-4 w-4" />
      {thumbnail === null ? 'Thumbnail prompt' : 'Write the thumbnail prompt again'}
    </button>
  );
  if (thumbnail === null) {
    return onWrite ? (
      <div className="flex flex-col gap-1">
        {button}
        <span className="text-body-sm text-outline">
          Looks at the thumbnails winning on this map and writes a detailed prompt for this title.
          An AI run of a minute or two.
        </span>
      </div>
    ) : null;
  }
  const learned = thumbnail.learnedFrom.length;
  return (
    <details className="group min-w-0 rounded bg-space-deep">
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 rounded p-space-sm focus:outline-none focus-visible:ring-1 focus-visible:ring-primary-container [&::-webkit-details-marker]:hidden">
        <ChevronRight
          aria-hidden="true"
          className="h-4 w-4 flex-none text-outline transition-transform group-open:rotate-90"
        />
        <span className="text-body-sm font-semibold text-on-surface">Thumbnail prompt ready</span>
        <span className="text-body-sm text-outline">
          {learned > 0 ? `learned from ${learned} winning thumbnails` : 'open to read and copy'}
        </span>
      </summary>
      <div className="flex min-w-0 flex-col gap-2 px-space-sm pb-space-sm">
        <ReadyPrompt
          label="thumbnail prompt"
          text={thumbnail.prompt}
          fileTitle={`${title} thumbnail prompt`}
          learnedFrom={thumbnail.learnedFrom}
          note={thumbnail.why}
        />
        {button}
      </div>
    </details>
  );
}
