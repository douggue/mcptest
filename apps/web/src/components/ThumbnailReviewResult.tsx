import { readSections, type AnswerBlock } from '../lib/analyses';
import { thumbnailUrl, watchUrl } from '../lib/format';
import {
  comparedLine,
  flagText,
  liftText,
  scoreText,
  shownRows,
  valueText,
  winnersText,
  type CompareThumb,
  type ThumbReviewView,
} from '../lib/thumbReview';
import { namedIds, withoutRefs } from '../lib/videoRefs';
import { Card, Label } from './layout/Card';
import { ReadyPrompt } from './ReadyPrompt';

/** One winner as a small thumbnail with its score, opening the video. */
function WinnerChip({ thumb }: { readonly thumb: CompareThumb }) {
  const href = watchUrl(thumb.videoId);
  const src = thumbnailUrl(thumb.videoId);
  if (href === null || src === null) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={`${thumb.title} · ${thumb.channelTitle}`}
      className="flex w-28 flex-none flex-col gap-1 rounded focus:outline-none focus-visible:ring-1 focus-visible:ring-primary-container sm:w-32"
    >
      <span className="relative block aspect-video w-full overflow-hidden rounded bg-surface-container-high">
        <img
          src={src}
          alt={`Thumbnail of “${thumb.title}”`}
          loading="lazy"
          referrerPolicy="no-referrer"
          className="h-full w-full object-cover"
        />
        <span className="absolute bottom-1 right-1 rounded bg-space-deep/90 px-1 text-label text-metric-amber">
          {scoreText(thumb.score)}
        </span>
      </span>
      <span className="truncate text-label text-outline">{thumb.channelTitle}</span>
    </a>
  );
}

/** The counted comparison as a small table: winning values, then flagged ones. */
function CountTable({ view }: { readonly view: ThumbReviewView }) {
  const rows = shownRows(view);
  if (rows.length === 0) {
    return (
      <p className="text-body-sm text-on-surface-variant">
        No value is shared by winners in two or more channels yet.
      </p>
    );
  }
  return (
    <ul className="flex flex-col divide-y divide-border-subtle text-body-sm">
      {rows.map((row) => (
        <li key={`${row.key}-${row.value}`} className="flex min-w-0 flex-col gap-0.5 py-2">
          <span className="flex flex-wrap items-baseline justify-between gap-x-space-md">
            <span className="font-semibold text-on-surface">{valueText(row)}</span>
            <span className={row.yours ? 'text-primary' : 'text-metric-amber'}>
              {row.flag ? '' : row.yours ? 'Yours has it' : 'Yours lacks it'}
            </span>
          </span>
          <span className="text-on-surface-variant">
            {winnersText(row)} · {liftText(row)}
          </span>
          {row.flag && <span className="text-outline">{flagText(row.flag)}</span>}
        </li>
      ))}
    </ul>
  );
}

/** One block of the advice, its markers turned into the winners it names. */
function AdviceBlock({
  block,
  winners,
}: {
  readonly block: AnswerBlock;
  readonly winners: readonly CompareThumb[];
}) {
  const named = namedIds(block.text).flatMap((id) =>
    winners.filter((thumb) => thumb.videoId === id),
  );
  const text = withoutRefs(block.text);
  const words = block.kind === 'field' ? `${block.label}: ${text}` : text;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <p
        className={`text-body-md text-on-surface ${block.kind === 'item' ? "before:mr-2 before:text-outline before:content-['–']" : ''}`}
      >
        {words}
      </p>
      {named.length > 0 && (
        <div className="flex min-w-0 flex-wrap gap-2">
          {named.map((thumb) => (
            <WinnerChip key={thumb.videoId} thumb={thumb} />
          ))}
        </div>
      )}
    </div>
  );
}

function Advice({
  text,
  winners,
}: {
  readonly text: string;
  readonly winners: readonly CompareThumb[];
}) {
  return (
    <div className="flex min-w-0 flex-col gap-space-md">
      {readSections(text).map((section, index) => (
        <section key={`${index}-${section.title ?? ''}`} className="flex min-w-0 flex-col gap-2">
          {section.title && <h4 className="text-label text-outline">{section.title}</h4>}
          {section.blocks.map((block, at) => (
            <AdviceBlock key={at} block={block} winners={winners} />
          ))}
        </section>
      ))}
    </div>
  );
}

/** A kept review: the thumbnail big, the winners it was set against, the count, the advice and the prompt. */
export function ThumbnailReviewResult({ view }: { readonly view: ThumbReviewView }) {
  const src = thumbnailUrl(view.target.videoId);
  return (
    <div className="flex min-w-0 flex-col gap-space-lg">
      <div className="grid min-w-0 grid-cols-1 gap-space-lg lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <figure className="flex min-w-0 flex-col gap-2">
          <span className="block aspect-video w-full overflow-hidden rounded-lg bg-surface-container-high">
            {src && (
              <img
                src={src}
                alt={`Thumbnail of “${view.target.title}”`}
                referrerPolicy="no-referrer"
                className="h-full w-full object-cover"
              />
            )}
          </span>
          <figcaption className="flex flex-col gap-0.5">
            <span className="text-body-md font-semibold text-on-surface">{view.target.title}</span>
            {view.target.tags && (
              <span className="text-body-sm text-on-surface-variant">
                {view.target.tags.description}
              </span>
            )}
          </figcaption>
        </figure>
        <Card>
          <Label>What the winners share</Label>
          <p className="text-body-sm text-outline">{comparedLine(view)}</p>
          <CountTable view={view} />
        </Card>
      </div>
      <div className="flex min-w-0 flex-col gap-space-sm">
        <Label>Winning thumbnails compared</Label>
        <div className="flex min-w-0 gap-2 overflow-x-auto pb-1">
          {view.winners.map((thumb) => (
            <WinnerChip key={thumb.videoId} thumb={thumb} />
          ))}
        </div>
      </div>
      {view.answer ? (
        <Card>
          <Advice text={view.answer.text} winners={view.winners} />
          {view.answer.prompt && (
            <ReadyPrompt
              label="thumbnail prompt"
              text={view.answer.prompt}
              fileTitle={`thumbnail prompt ${view.target.title}`}
            />
          )}
        </Card>
      ) : (
        <p className="text-body-sm text-on-surface-variant">
          The count is kept, but the advice was not written. Review it again.
        </p>
      )}
    </div>
  );
}
