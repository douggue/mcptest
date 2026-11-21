import { Clapperboard } from 'lucide-react';
import { readableBlocks, type LinePart, type ScriptBlock } from '../lib/scriptRead';

/** A spoken line, with each fact to check underlined in amber and what to check on hover. */
function Line({ parts }: { readonly parts: readonly LinePart[] }) {
  return (
    <p className="text-body-lg text-on-surface">
      {parts.map((part, index) =>
        part.kind === 'text' ? (
          <span key={index}>{part.text} </span>
        ) : (
          <mark
            key={index}
            title={`Check: ${part.what}`}
            className="mx-0.5 rounded bg-metric-amber-bg px-1.5 text-body-sm text-metric-amber"
          >
            check: {part.what}
          </mark>
        ),
      )}
    </p>
  );
}

/** A picture cue as a quiet chip: what to show, with the search phrase and the sound. */
function Cue({ block }: { readonly block: Extract<ScriptBlock, { kind: 'cue' }> }) {
  return (
    <div className="flex min-w-0 items-start gap-2 rounded border border-border-subtle bg-surface-container-low px-3 py-2 text-body-sm text-on-surface-variant">
      <Clapperboard aria-hidden="true" className="mt-0.5 h-4 w-4 flex-none text-outline" />
      <span className="min-w-0 break-words">
        {block.show}
        {block.search && <span className="text-outline"> · search “{block.search}”</span>}
        {block.sound && <span className="text-outline"> · sound: {block.sound}</span>}
      </span>
    </div>
  );
}

/**
 * The script as it will be read aloud: headings, picture cues as chips and
 * the spoken lines in large type, with facts to check marked where they sit.
 */
export function ScriptReader({ text }: { readonly text: string }) {
  const blocks = readableBlocks(text);
  if (blocks.length === 0) {
    return (
      <p className="text-body-md text-on-surface-variant">
        Nothing written yet. Run this step, or switch to Edit to write it yourself.
      </p>
    );
  }
  return (
    <div className="flex min-w-0 flex-col gap-3 pb-16">
      {blocks.map((block, index) => {
        if (block.kind === 'heading') {
          return (
            <h4 key={index} className="pt-space-sm text-title-md text-primary">
              {block.text}
            </h4>
          );
        }
        if (block.kind === 'cue') return <Cue key={index} block={block} />;
        return <Line key={index} parts={block.parts} />;
      })}
    </div>
  );
}
