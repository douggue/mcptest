import { useState } from 'react';
import { scriptStats, type ScriptView } from '../lib/scriptWriter';
import { Details } from './layout/Details';
import { Segmented } from './layout/Segmented';
import { ScriptReader } from './ScriptReader';

const LABEL = 'text-label text-outline';
const AREA =
  'min-h-[32rem] w-full min-w-0 rounded-lg border border-border-subtle bg-space-deep p-space-md text-body-md leading-7 text-on-surface focus:outline-none focus-visible:ring-1 focus-visible:ring-primary-container';

type Mode = 'read' | 'edit';

interface Props {
  readonly view: ScriptView;
  /** Which text is in the editor. */
  readonly which: 'draft' | 'tightened';
  readonly onChange: (text: string) => void;
}

/** How the markers are written, for when the owner edits the text itself. */
function MarkerHelp({ markFacts }: { readonly markFacts: boolean }) {
  return (
    <Details summary="How cues and checks are written">
      <p className="text-body-sm text-on-surface-variant">
        A line starting with ## is a heading. A line like [B-ROLL: what to show | search phrase |
        sound] is a picture cue.
        {markFacts
          ? ' [CHECK: what to verify] after a claim marks a fact to check; delete the marker once you have checked it.'
          : ''}{' '}
        None of these counts as spoken words.
      </p>
    </Details>
  );
}

/**
 * The draft or the tightened draft: read as it will be spoken, with picture
 * cues as chips and facts to check marked, or edited as plain text. What is
 * counted about it sits in the footer bar and the side panel.
 */
export function ScriptEditor({ view, which, onChange }: Props) {
  const [mode, setMode] = useState<Mode>('read');
  const text = view.script?.[which] ?? '';
  const markFacts = view.markFacts ?? true;
  const cues = scriptStats(text, null, markFacts).cues;
  return (
    <div className="flex min-w-0 flex-col gap-space-md">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <span className={LABEL}>
          {which === 'draft' ? 'The draft' : 'The tightened draft'} · {cues} picture cues
        </span>
        <Segmented<Mode>
          label="Read or edit the script"
          options={[
            { value: 'read', label: 'Read' },
            { value: 'edit', label: 'Edit' },
          ]}
          value={mode}
          onChange={setMode}
        />
      </div>
      {mode === 'read' ? (
        <ScriptReader text={text} />
      ) : (
        <>
          <textarea
            aria-label={which === 'draft' ? 'The draft' : 'The tightened draft'}
            value={text}
            onChange={(event) => onChange(event.target.value)}
            spellCheck
            className={AREA}
          />
          <MarkerHelp markFacts={markFacts} />
        </>
      )}
    </div>
  );
}
