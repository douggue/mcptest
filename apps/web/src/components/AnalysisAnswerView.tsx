import { keptLine, type AnalysisAnswer } from '../lib/analyses';
import { Answer, Credit } from './Answer';
import { ReadyPrompt } from './ReadyPrompt';

interface Props {
  readonly title: string;
  readonly answer: AnalysisAnswer;
  /** True for an answer kept from an earlier run rather than one just given. */
  readonly kept: boolean;
}

/**
 * One quick analysis's answer: its points with the thumbnails of the videos
 * they rest on, the ready prompt it ends with in a box of its own, and who
 * wrote it.
 */
export function AnalysisAnswerView({ title, answer, kept }: Props) {
  const when = kept ? keptLine(answer.writtenAt) : '';
  return (
    <div className="flex min-w-0 flex-col gap-space-sm">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-space-sm">
        <h3 className="text-title-md text-on-surface">{title}</h3>
        {when !== '' && <span className="text-body-sm text-outline">{when}</span>}
      </div>
      <Answer text={answer.text} videos={answer.videos} />
      {answer.prompt !== null && (
        <ReadyPrompt label="thumbnail prompt" text={answer.prompt} fileTitle="thumbnail prompt" />
      )}
      <Credit answer={answer} />
    </div>
  );
}
