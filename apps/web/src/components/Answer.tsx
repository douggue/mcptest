import {
  answerCredit,
  readSections,
  skippedNotes,
  type AnalysisAnswer,
  type AnswerBlock,
} from '../lib/analyses';
import { pointOf, videoIndex, type NamedVideo, type VideoIndex } from '../lib/videoRefs';
import { VideoChips } from './VideoChips';

/** A title field gives its options side by side with a slash; each is shown on a line of its own. */
const TITLE_LABEL = 'TITLE';

interface BlockProps {
  readonly block: AnswerBlock;
  readonly known: VideoIndex;
}

/**
 * One block of an answer: a labelled row, a list item or a paragraph, shown
 * as text only, with the thumbnails of the stored videos it names beneath.
 */
export function Block({ block, known }: BlockProps) {
  const { text, videos } = pointOf(block.text, known);
  if (block.kind === 'field') {
    const lines = block.label === TITLE_LABEL ? text.split(' / ') : [text];
    return (
      <div className="grid grid-cols-1 gap-x-space-md gap-y-0.5 sm:grid-cols-[10rem_minmax(0,1fr)]">
        <span className="pt-0.5 text-label text-outline">{block.label}</span>
        <span className="flex min-w-0 flex-col gap-1 text-body-md text-on-surface">
          {lines.map((line) => (
            <span key={line} className={block.label === TITLE_LABEL ? 'font-semibold' : ''}>
              {line}
            </span>
          ))}
          <VideoChips videos={videos} />
        </span>
      </div>
    );
  }
  if (block.kind === 'item') {
    return (
      <div className="flex gap-2 text-body-md text-on-surface">
        <span aria-hidden="true" className="text-outline">
          –
        </span>
        <div className="flex min-w-0 flex-col">
          <p className="break-words">{text}</p>
          <VideoChips videos={videos} />
        </div>
      </div>
    );
  }
  return (
    <div className="flex min-w-0 flex-col">
      <p className="break-words text-body-md text-on-surface">{text}</p>
      <VideoChips videos={videos} />
    </div>
  );
}

interface AnswerProps {
  readonly text: string;
  /** The stored videos the answer names; a marker naming any other id is dropped. */
  readonly videos?: readonly NamedVideo[];
}

/**
 * The answer, set out section by section. A numbered section, such as one
 * video idea, is a card of its own, so its lines are never run together with
 * the next one's. A video the answer names is shown as its real thumbnail
 * beside the point it was named for.
 */
export function Answer({ text, videos = [] }: AnswerProps) {
  const known = videoIndex(videos);
  return (
    <div className="flex flex-col gap-space-md rounded bg-surface-card p-space-lg">
      {readSections(text).map((section, index) => (
        <section
          key={`${index}-${section.title ?? 'start'}`}
          className={`flex flex-col gap-2 ${section.numbered ? 'rounded bg-space-deep p-space-md' : ''}`}
        >
          {section.title !== null && (
            <h4
              className={
                section.numbered
                  ? 'text-title-md font-semibold text-on-surface'
                  : 'text-label text-primary'
              }
            >
              {section.title}
            </h4>
          )}
          {section.blocks.map((block, at) => (
            <Block key={`${at}-${block.kind}`} block={block} known={known} />
          ))}
        </section>
      ))}
    </div>
  );
}

/** Who answered, and for each engine passed over, why: that often says what to do about it. */
export function Credit({
  answer,
}: {
  readonly answer: Pick<AnalysisAnswer, 'engine' | 'skipped'>;
}) {
  const credit = answerCredit(answer);
  if (credit === '') return null;
  return (
    <div className="flex flex-col gap-1 text-body-sm text-outline">
      <p>{credit}</p>
      {skippedNotes(answer.skipped).map((note) => (
        <p key={note}>{note}</p>
      ))}
    </div>
  );
}
