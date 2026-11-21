import type { AnswerBlock, AnswerSection } from '../lib/analyses';
import { moreLabel, outlineOf, splitBlocks, summaryAfterLead } from '../lib/longAnswer';
import { videoIndex, type NamedVideo, type VideoIndex } from '../lib/videoRefs';
import { Block } from './Answer';
import { Card, Label } from './layout/Card';
import { Details } from './layout/Details';

function Blocks({
  blocks,
  known,
}: {
  readonly blocks: readonly AnswerBlock[];
  readonly known: VideoIndex;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-space-sm">
      {blocks.map((block, at) => (
        <Block key={`${at}-${block.kind}`} block={block} known={known} />
      ))}
    </div>
  );
}

/** One titled section on a card of its own: its first points, and the rest behind "More". */
function SectionCard({
  section,
  known,
}: {
  readonly section: AnswerSection;
  readonly known: VideoIndex;
}) {
  const { shown, more } = splitBlocks(section.blocks);
  return (
    <Card as="article">
      {section.numbered ? (
        <h4 className="break-words text-title-md font-semibold text-on-surface">{section.title}</h4>
      ) : (
        <Label>{section.title}</Label>
      )}
      <Blocks blocks={shown} known={known} />
      {more.length > 0 && (
        <Details summary={moreLabel(more.length)}>
          <Blocks blocks={more} known={known} />
        </Details>
      )}
    </Card>
  );
}

interface Props {
  readonly text: string;
  /** The stored videos the answer names; a marker naming any other id is dropped. */
  readonly videos?: readonly NamedVideo[];
  /** The opening line is already shown above the answer, so the summary starts after it. */
  readonly leadShown?: boolean;
}

/**
 * A long AI answer made easy to read: what it says in short first, then
 * each section as a card with its first points, the rest behind "More".
 */
export function LongAnswer({ text, videos = [], leadShown = false }: Props) {
  const known = videoIndex(videos);
  const outline = outlineOf(text);
  const { sections } = outline;
  const summary = leadShown ? summaryAfterLead(outline.summary) : outline.summary;
  return (
    <div className="flex min-w-0 flex-col gap-space-md">
      {summary.length > 0 && (
        <Card highlighted>
          <Label>In short</Label>
          <Blocks blocks={summary} known={known} />
        </Card>
      )}
      {sections.map((section, index) => (
        <SectionCard key={`${index}-${section.title ?? ''}`} section={section} known={known} />
      ))}
    </div>
  );
}
