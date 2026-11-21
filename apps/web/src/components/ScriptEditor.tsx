import { scriptStats, type ScriptView } from '../lib/scriptWriter';

const LABEL = 'text-label text-outline';
const AREA =
  'min-h-[32rem] w-full min-w-0 rounded-lg border border-border-subtle bg-space-deep p-space-md font-mono text-body-sm leading-relaxed text-on-surface focus:outline-none focus-visible:ring-1 focus-visible:ring-primary-container';

interface Props {
  readonly view: ScriptView;
  /** Which text is in the editor. */
  readonly which: 'draft' | 'tightened';
  readonly onChange: (text: string) => void;
}

/**
 * The wide editor for the draft or the tightened draft. What is counted
 * about the text sits in the footer bar and the side panel.
 */
export function ScriptEditor({ view, which, onChange }: Props) {
  const text = view.script?.[which] ?? '';
  const markFacts = view.markFacts ?? true;
  const cues = scriptStats(text, null, markFacts).cues;
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <label className="flex min-w-0 flex-col gap-1">
        <span className={LABEL}>
          {which === 'draft' ? 'The draft' : 'The tightened draft'} · {cues} picture cues
        </span>
        <textarea
          value={text}
          onChange={(event) => onChange(event.target.value)}
          spellCheck
          className={AREA}
        />
      </label>
      <p className="text-body-sm text-outline">
        A line starting with ## is a heading. A line like [B-ROLL: what to show | search phrase |
        sound] is a picture cue.
        {markFacts
          ? ' [CHECK: what to verify] after a claim marks a fact to check; delete the marker once you have checked it.'
          : ''}{' '}
        None of these counts as spoken words.
      </p>
    </div>
  );
}
