import { keptLine, type AnalysisAnswer } from '../lib/analyses';
import { Credit } from './Answer';
import { useConnections } from './Connections';
import { Card } from './layout/Card';
import { Details } from './layout/Details';
import { ViewHeader } from './layout/ViewHeader';
import { LongAnswer } from './LongAnswer';
import { QUIET_BUTTON } from './LabStatus';
import { ReadyPrompt } from './ReadyPrompt';

interface Props {
  readonly title: string;
  readonly answer: AnalysisAnswer;
  /** True for an answer kept from an earlier run rather than one just given. */
  readonly kept: boolean;
}

/** The ready prompt a thumbnail review ends with, closed until it is wanted. */
function PromptCard({ prompt }: { readonly prompt: string }) {
  const links = useConnections();
  return (
    <Card>
      <Details summary="The thumbnail prompt it ends with">
        <ReadyPrompt label="thumbnail prompt" text={prompt} fileTitle="thumbnail prompt" />
      </Details>
      {links && (
        <div className="flex min-w-0 flex-col items-start gap-1">
          <button type="button" onClick={links.useReviewStyle} className={QUIET_BUTTON}>
            Use this style for a concept&rsquo;s thumbnail prompt
          </button>
          <span className="text-body-sm text-outline">
            Each concept&rsquo;s &ldquo;Thumbnail prompt&rdquo; reads this review.
          </span>
        </div>
      )}
    </Card>
  );
}

/**
 * One quick analysis's answer: its title and when it was written, what it
 * says in short, its sections as cards with the thumbnails of the videos
 * they rest on, the ready prompt it ends with, and who wrote it.
 */
export function AnalysisAnswerView({ title, answer, kept }: Props) {
  const when = kept ? keptLine(answer.writtenAt) : 'Just written.';
  return (
    <div className="flex min-w-0 flex-col gap-space-lg">
      <ViewHeader title={title} lead={when === '' ? undefined : when} />
      <LongAnswer text={answer.text} videos={answer.videos} />
      {answer.prompt !== null && <PromptCard prompt={answer.prompt} />}
      <Credit answer={answer} />
    </div>
  );
}
