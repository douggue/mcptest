import { Image } from 'lucide-react';
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
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <ReadyPrompt
        label="thumbnail prompt"
        text={thumbnail.prompt}
        fileTitle={`${title} thumbnail prompt`}
        learnedFrom={thumbnail.learnedFrom}
        note={thumbnail.why}
      />
      {button}
    </div>
  );
}
