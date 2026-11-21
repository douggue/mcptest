import { answerCredit, readAnswer, skippedNotes, type AnalysisAnswer } from '../lib/analyses';

/** The answer, set out as headings, list items and paragraphs. Shown as text only. */
export function Answer({ text }: { readonly text: string }) {
  const blocks = readAnswer(text);
  return (
    <div className="flex flex-col gap-2 rounded bg-surface-card p-space-lg">
      {blocks.map((block, index) => {
        const key = `${index}-${block.kind}`;
        if (block.kind === 'heading') {
          return (
            <h4 key={key} className="mt-2 text-label-caps uppercase text-primary first:mt-0">
              {block.text}
            </h4>
          );
        }
        if (block.kind === 'item') {
          return (
            <p key={key} className="flex gap-2 text-body-md text-on-surface">
              <span aria-hidden="true" className="text-outline">
                –
              </span>
              <span>{block.text}</span>
            </p>
          );
        }
        return (
          <p key={key} className="text-body-md text-on-surface">
            {block.text}
          </p>
        );
      })}
    </div>
  );
}

/** Who answered, and for each engine passed over, why: that often says what to do about it. */
export function Credit({ answer }: { readonly answer: AnalysisAnswer }) {
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
