// "Ask for a change" in the editor's top bar: a plain-language edit, turned into typed changes by the AI and
// applied as one step that Ctrl+Z undoes.
import { useState } from 'react';

import { api } from '../api';
import { Button, toast, toastError, useJobRunner } from '../ui';
import { AskChange, AskResult, applyAsk, describeChange } from './ask';
import { EditSpec } from './logic';

type Props = {
  projectId: string; clipId: string; spec: EditSpec;
  update: (fn: (s: EditSpec) => EditSpec, key?: string) => void;
  jobs: ReturnType<typeof useJobRunner>;
  undo: () => void;
};

export function AskBar({ projectId, clipId, spec, update, jobs, undo }: Props) {
  const [text, setText] = useState('');
  const [last, setLast] = useState<{ request: string; reply: string; changes: AskChange[]; skipped: string[] } | null>(null);
  const busy = jobs.busy;

  async function ask() {
    const request = text.trim();
    if (!request || busy) return;
    try {
      const r = await jobs.run<AskResult>(() => api.post(`/api/projects/${projectId}/clips/${clipId}/ask`, { request, spec }));
      // applied to the clip as it is now (the editor is locked while the AI works), as one undoable step
      const out = applyAsk(spec, r.changes);
      if (out.made.length) update(() => out.spec);
      setLast({ request, reply: r.reply, changes: out.made, skipped: out.skipped });
      setText('');
      if (!r.changes.length) toast(r.reply || 'Nothing to change.');
    } catch (e) { toastError(e); }
  }

  return (
    <div className="ask-bar">
      <form className="ask-input" onSubmit={(e) => { e.preventDefault(); ask(); }}>
        <input type="text" value={text} onChange={(e) => setText(e.target.value)} disabled={busy} aria-label="Ask for a change"
          placeholder="Ask for a change… e.g. make the title red and freeze 1 s when he says sorry" />
        <Button small variant="primary" icon="sparkle" type="submit" disabled={!text.trim() || busy} busy={busy}>Ask</Button>
      </form>
      {last && (
        <div className="ask-result" role="status">
          <div className="row between"><b className="small ellipsis" title={last.request}>“{last.request}”</b>
            <Button small variant="ghost" icon="x" aria-label="Close" onClick={() => setLast(null)} /></div>
          {last.reply && <div className="small">{last.reply}</div>}
          {last.changes.length > 0 && <ul className="notes-list">{last.changes.map((c, i) => <li key={i}>{describeChange(c)}</li>)}</ul>}
          {last.skipped.length > 0 && <div className="small" style={{ color: 'var(--bad)' }}>{last.skipped.join(' ')}</div>}
          {last.changes.length > 0 && <div className="row"><Button small icon="undo" onClick={() => { undo(); setLast(null); }}>Undo this</Button></div>}
        </div>
      )}
    </div>
  );
}
