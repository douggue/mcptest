// Styles manager: your own styles learned from reference videos, and the built-in ones.
import { useEffect, useRef, useState } from 'react';

import { api, upload } from '../api';
import { Button, Empty, Field, JobBar, Panel, Toggle, fmtDur, toast, toastError, useJobRunner } from '../ui';
import { StyleProfile, StyleRule } from './types';

export default function Styles() {
  const [styles, setStyles] = useState<StyleProfile[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [uploading, setUploading] = useState('');
  const [newRule, setNewRule] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const { job, run, busy } = useJobRunner();

  const load = () => api.get<StyleProfile[]>('/api/profiles').then(setStyles).catch(toastError);
  useEffect(() => { load(); }, []);
  const open = styles.find((x) => x.id === openId) ?? null;
  const mine = styles.filter((x) => !x.builtin);
  const builtin = styles.filter((x) => x.builtin);

  async function create(from?: StyleProfile) {
    const n = from ? prompt('Name your copy of this style:', `My ${from.name.toLowerCase()}`) : name;
    if (!n?.trim()) return;
    try {
      const p = await api.post<StyleProfile>('/api/profiles', { name: n.trim(), from: from?.id });
      setName('');
      await load();
      setOpenId(p.id);
    } catch (e) { toastError(e); }
  }

  async function addReferences(files: FileList | null) {
    if (!files || !open) return;
    const list = Array.from(files);
    for (let i = 0; i < list.length; i++) {
      setUploading(`Uploading ${i + 1} of ${list.length}…`);
      const form = new FormData();
      form.append('file', list[i]);
      await upload(`/api/profiles/${open.id}/references`, form).catch(toastError);
    }
    setUploading('');
    load();
  }

  async function analyse() {
    if (!open) return;
    try {
      const p = await run<StyleProfile>(() => api.post(`/api/profiles/${open.id}/analyse`));
      await load();
      toast(p.note || `Style learned from ${p.references?.length ?? 0} reference${p.references?.length === 1 ? '' : 's'}`, p.note ? 'info' : 'good');
    } catch (e) { toastError(e); }
  }

  const saveRules = async (rules: StyleRule[]) => { if (open) { await api.put(`/api/profiles/${open.id}`, { rules }).catch(toastError); load(); } };
  const saveBrief = async (brief: string) => { if (open) await api.put(`/api/profiles/${open.id}`, { brief }).catch(toastError); };

  if (open) {
    const a = open.analysis;
    const fixed = !!open.builtin;
    return (
      <>
        <div className="row between wrap">
          <div>
            <button className="crumb" style={{ background: 'none', border: 0, cursor: 'pointer', padding: 0 }} onClick={() => setOpenId(null)}>← All styles</button>
            <h2>{open.name}{open.draft ? ' (draft)' : ''}</h2>
          </div>
          <div className="row">
            {fixed ? <Button icon="copy" onClick={() => create(open)}>Copy to make it yours</Button>
              : <Button variant="danger" icon="trash" onClick={async () => { if (confirm(`Delete the style "${open.name}" and its references?`)) { await api.del(`/api/profiles/${open.id}`).catch(toastError); setOpenId(null); load(); } }}>Delete style</Button>}
          </div>
        </div>

        {!fixed && (
          <Panel title={`Reference videos (${open.references?.length ?? 0})`} actions={<>
            <Button small icon="upload" onClick={() => fileRef.current?.click()}>Add videos</Button>
            <Button small variant="primary" icon="sparkle" onClick={analyse} busy={busy} disabled={!open.references?.length}>{open.analysed ? 'Study again' : 'Study the style'}</Button>
          </>}>
            <p className="muted">Upload several videos in the style you want. The more you add, the better it separates the style from one-off choices. With a Gemini key the whole videos are watched; with a Claude key, sampled frames are studied.</p>
            <input ref={fileRef} type="file" accept="video/*,.mkv" multiple hidden onChange={(e) => { addReferences(e.target.files); e.target.value = ''; }} />
            {uploading && <div className="notice">{uploading}</div>}
            <JobBar job={job} />
            {(open.references?.length ?? 0) === 0 ? <Empty icon="film" title="No references yet">Add two to five short videos that share the look you are after.</Empty> : (
              <div className="media-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))' }}>
                {open.references!.map((r) => (
                  <div key={r.file} className="card" style={{ padding: 8 }}>
                    <video src={r.url} className="thumb tall" muted preload="metadata" controls />
                    <div className="row between small"><span className="ellipsis" title={r.name}>{r.name}</span>
                      <Button small variant="ghost" icon="trash" aria-label={`Remove ${r.name}`} onClick={async () => { await api.del(`/api/profiles/${open.id}/references/${encodeURIComponent(r.file)}`).catch(toastError); load(); }} /></div>
                    {r.duration ? <span className="small muted mono">{fmtDur(r.duration)} · cut every {r.shot_seconds?.toFixed(1)}s</span> : <span className="small faint">Not studied yet</span>}
                  </div>
                ))}
              </div>
            )}
            {open.note && <div className="notice warn">{open.note}</div>}
          </Panel>
        )}

        {(a || open.summary) && (
          <Panel title="What this style is">
            <p>{a?.summary || open.summary}</p>
            {a?.pacing && <p className="muted">{a.pacing}</p>}
            {a && a.elements.length > 0 && <div className="col gap-s">{a.elements.map((e, i) => <div key={i} className="small"><span className="pill">{e.type.replace('_', ' ')}</span> <span className="muted">{e.how}</span></div>)}</div>}
            {a && a.varies.length > 0 && <div className="notice"><b>Varies between references:</b> {a.varies.join(' ')}</div>}
            {a && a.cannot_reproduce.length > 0 && <div className="notice warn"><b>Cannot be reproduced here:</b> {a.cannot_reproduce.join(' ')}</div>}
            {a && a.unsure.length > 0 && <div className="notice"><b>Could not tell:</b> {a.unsure.join(' ')}</div>}
          </Panel>
        )}

        <Panel title="Brief for the AI">
          <textarea rows={4} defaultValue={open.brief} key={open.id + (open.analysed ?? '')} disabled={fixed} placeholder="One paragraph describing how videos in this style are made."
            onBlur={(e) => !fixed && e.target.value !== open.brief && saveBrief(e.target.value)} />
        </Panel>

        <Panel title={`Rules (${open.rules.filter((r) => r.on).length} active)`}>
          <p className="muted">Every AI request for a clip in this style carries the active rules. Corrections you teach in the editor land here.</p>
          {open.rules.length === 0 && <span className="small muted">No rules yet.</span>}
          {open.rules.map((r) => (
            <div key={r.id} className="asset-row" style={{ alignItems: 'flex-start' }}>
              {!fixed && <Toggle checked={r.on} onChange={(v) => saveRules(open.rules.map((x) => (x.id === r.id ? { ...x, on: v } : x)))} />}
              <div className="grow">
                {fixed ? <div>{r.text}</div> : <textarea rows={2} defaultValue={r.text} onBlur={(e) => e.target.value.trim() !== r.text && saveRules(open.rules.map((x) => (x.id === r.id ? { ...x, text: e.target.value.trim(), source: 'you' } : x)))} />}
                <div className="small faint">{r.kind} · from {r.source}</div>
              </div>
              {!fixed && <Button small variant="ghost" icon="trash" aria-label="Delete rule" onClick={() => saveRules(open.rules.filter((x) => x.id !== r.id))} />}
            </div>
          ))}
          {!fixed && (
            <div className="row">
              <input type="text" value={newRule} placeholder="Add a rule in your own words" onChange={(e) => setNewRule(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && newRule.trim()) { saveRules([...open.rules, { id: '', kind: 'editing', text: newRule.trim(), source: 'you', on: true }]); setNewRule(''); } }} />
              <Button icon="plus" disabled={!newRule.trim()} onClick={() => { saveRules([...open.rules, { id: '', kind: 'editing', text: newRule.trim(), source: 'you', on: true }]); setNewRule(''); }}>Add</Button>
            </div>
          )}
        </Panel>
      </>
    );
  }

  return (
    <>
      <Panel title="Make your own style">
        <p className="muted">Name a style, add reference videos you like, and have the AI study them. The result is a look the editor can apply plus written rules you can read and edit. It learns from your corrections as you work.</p>
        <div className="row">
          <Field label="Name" grow><input type="text" value={name} placeholder="e.g. Street interviews" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && create()} /></Field>
          <Button variant="primary" icon="plus" onClick={() => create()} disabled={!name.trim()} style={{ alignSelf: 'flex-end' }}>Create</Button>
        </div>
      </Panel>
      {mine.length > 0 && (
        <Panel title={`Your styles (${mine.length})`} pad={false}>
          <div className="panel-body grid-auto" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
            {mine.map((x) => (
              <div key={x.id} className="card click" onClick={() => setOpenId(x.id)}>
                <strong>{x.name}</strong>
                <span className="small muted clamp-2">{x.analysis?.summary || x.summary || 'Not studied yet. Add reference videos.'}</span>
                <div className="row between small muted"><span>{x.references?.length ?? 0} references · {x.rules.filter((r) => r.on).length} rules</span><span className={'pill ' + (x.analysed ? 'good' : 'muted')}>{x.analysed ? 'Learned' : 'New'}</span></div>
              </div>
            ))}
          </div>
        </Panel>
      )}
      <Panel title="Built-in styles" pad={false}>
        <div className="panel-body grid-auto" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
          {builtin.map((x) => (
            <div key={x.id} className="card click" onClick={() => setOpenId(x.id)}>
              <div className="row between"><strong>{x.name}</strong>{x.draft && <span className="pill">Draft</span>}</div>
              <span className="small muted">{x.summary}</span>
              <span className="small faint">{x.style.width}×{x.style.height} · {x.style.fps} fps · {x.rules.length} rules</span>
            </div>
          ))}
        </div>
      </Panel>
    </>
  );
}
