import { useEffect, useRef, useState } from 'react';

import { go } from '../App';
import { api, upload } from '../api';
import { Button, Empty, Field, Icon, JobBar, Panel, Seg, fmtDur, fmtTime, toast, toastError, useJobRunner } from '../ui';
import { Clip, Project, Score, Template } from './types';

export function ScoreRing({ score }: { score: Score | null }) {
  if (!score) return <div className="score" style={{ ['--v' as any]: 0 }} title="Not scored"><span>–</span></div>;
  return <div className="score" style={{ ['--v' as any]: score.total }} title="Virality score out of 100"><span>{score.total}</span></div>;
}

function ScoreTiles({ score }: { score: Score }) {
  return (
    <div className="score-tiles">
      {(['hook', 'flow', 'value', 'trend'] as const).map((k) => (
        <div key={k} className="score-tile" title={`${k} score out of 100`}>
          <span>{k}</span>
          <b>{score[k]}<i>/100</i></b>
        </div>
      ))}
    </div>
  );
}

export function ProjectView({ project, reload }: { project: Project; reload: () => Promise<void> }) {
  const online = project.origin.startsWith('http');
  const [engine, setEngine] = useState<'whisper' | 'youtube'>('whisper');
  const [model, setModel] = useState('');
  const [language, setLanguage] = useState('');
  const [count, setCount] = useState(6);
  const [minLen, setMinLen] = useState(20);
  const [maxLen, setMaxLen] = useState(60);
  const [query, setQuery] = useState('');
  const [templates, setTemplates] = useState<Template[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [note, setNote] = useState('');
  const [range, setRange] = useState({ in: 0, out: Math.min(30, project.source.duration) });
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const tx = useJobRunner();
  const mo = useJobRunner();
  const ex = useJobRunner();
  const words = project.transcript?.words.length ?? 0;

  useEffect(() => { api.get<Template[]>('/api/templates').then(setTemplates).catch(() => {}); }, []);

  async function transcribe() {
    try {
      const r = await tx.run<{ words: number; engine: string }>(() =>
        api.post(`/api/projects/${project.id}/transcribe`, { engine, model: model || undefined, language: language || undefined }));
      toast(`Transcribed ${r.words} words`, 'good');
      await reload();
    } catch (e) { toastError(e); }
  }

  async function importTranscript(file: File) {
    try {
      const form = new FormData();
      form.append('file', file);
      const r = await upload<{ words: number }>(`/api/projects/${project.id}/transcript`, form);
      toast(`Imported ${r.words} words`, 'good');
      await reload();
    } catch (e) { toastError(e); }
  }

  async function findMoments() {
    try {
      const r = await mo.run<{ added: number; note: string; engine: string }>(() =>
        api.post(`/api/projects/${project.id}/moments`, { count, min_len: minLen, max_len: maxLen, query, template_id: templateId || undefined }));
      setNote(r.note);
      toast(r.added ? `Found ${r.added} moment${r.added === 1 ? '' : 's'}` : 'No matching moments found', r.added ? 'good' : 'info');
      await reload();
    } catch (e) { toastError(e); }
  }

  async function addManual() {
    try {
      const clip = await api.post<Clip>(`/api/projects/${project.id}/clips`, { in: range.in, out: range.out, title: 'Manual clip', template_id: templateId || undefined });
      await reload();
      go(`studio/${project.id}/${clip.id}`);
    } catch (e) { toastError(e); }
  }

  async function exportAll() {
    const targets = project.clips.filter((c) => c.status === 'approved');
    if (!targets.length) { toast('Mark clips as approved in the editor first', 'info'); return; }
    let done = 0;
    for (const c of targets) {
      try {
        await ex.run(() => api.post(`/api/projects/${project.id}/clips/${c.id}/render`, { quality: '1080' }));
        done++;
      } catch (e) { toastError(e); }
    }
    toast(`Exported ${done} of ${targets.length} approved clips`, done ? 'good' : 'bad');
  }

  const sorted = [...project.clips].sort((a, b) => (b.score?.total ?? -1) - (a.score?.total ?? -1) || a.spec.in - b.spec.in);

  return (
    <div className="page">
      <div className="page-head">
        <div style={{ minWidth: 0 }}>
          <a href="#/studio" className="crumb"><Icon name="back" size={13} /> All projects</a>
          <h1 className="ellipsis" title={project.name}>{project.name}</h1>
          <p>{fmtDur(project.source.duration)} · {project.source.width}×{project.source.height} · {Math.round(project.source.fps)} fps{online ? <> · <a href={project.origin} target="_blank" rel="noreferrer">source</a></> : null}</p>
        </div>
      </div>

      <div className="project-grid">
        <div className="col gap-l">
      <Panel title="Source video">
          <div className="col gap-l">
            <video ref={videoRef} className="source-video" src={project.source.url} poster={project.source.poster || undefined} controls preload="metadata" />
            <div className="col">
              <span className="small muted">Mark a clip yourself: play to a spot and set the start and end.</span>
              <div className="grid-2">
                <Field label="Start">
                  <div className="row">
                    <input className="mono" type="text" value={fmtTime(range.in, true)} readOnly />
                    <Button small onClick={() => setRange((r) => ({ ...r, in: Math.min(videoRef.current?.currentTime ?? 0, r.out - 1) }))}>Set at playhead</Button>
                  </div>
                </Field>
                <Field label="End">
                  <div className="row">
                    <input className="mono" type="text" value={fmtTime(range.out, true)} readOnly />
                    <Button small onClick={() => setRange((r) => ({ ...r, out: Math.max(videoRef.current?.currentTime ?? 0, r.in + 1) }))}>Set at playhead</Button>
                  </div>
                </Field>
              </div>
              <div className="row">
                <Button icon="plus" onClick={addManual}>Create clip ({fmtDur(range.out - range.in)})</Button>
              </div>
            </div>
          </div>
        </Panel>
        </div>
        <div className="col gap-l">
        <Panel title={<><span className={'step-num' + (words ? ' done' : '')}>1</span>Transcript</>} actions={words ? <a className="btn small ghost" href={`/api/projects/${project.id}/transcript.srt`} download={`${project.name}.srt`}>Download SRT</a> : null}>
            <div className="row between">
              <span className={'pill ' + (words ? 'good' : 'muted')}>{words ? `${words.toLocaleString()} words · ${project.transcript!.engine}` : 'Not transcribed yet'}</span>
            </div>
            <Seg value={engine} onChange={setEngine} options={[
              { value: 'whisper', label: 'Whisper (on this computer)' },
              { value: 'youtube', label: 'Captions from the site', title: 'Uses the video\'s own word-timed captions; instant, needs a link import' },
            ]} />
            {engine === 'whisper' ? (
              <div className="grid-2">
                <Field label="Model" hint="Bigger is more accurate and slower.">
                  <select value={model} onChange={(e) => setModel(e.target.value)}>
                    <option value="">Default (from Settings)</option>
                    {['tiny', 'base', 'small', 'medium', 'large-v3'].map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </Field>
                <Field label="Language" hint="Leave empty to detect.">
                  <input type="text" placeholder="en" value={language} onChange={(e) => setLanguage(e.target.value)} />
                </Field>
              </div>
            ) : !online ? <div className="notice">This project came from a file, so there are no online captions. Use Whisper or import a file.</div> : null}
            <div className="row wrap">
              <Button variant="primary" icon="type" onClick={transcribe} busy={tx.busy} disabled={engine === 'youtube' && !online}>{words ? 'Transcribe again' : 'Transcribe'}</Button>
              <Button icon="upload" onClick={() => fileRef.current?.click()}>Import SRT / VTT / JSON</Button>
              <input ref={fileRef} type="file" accept=".srt,.vtt,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) importTranscript(f); e.target.value = ''; }} />
            </div>
            <JobBar job={tx.job} />
          </Panel>

          <Panel title={<><span className={'step-num' + (project.clips.length ? ' done' : '')}>2</span>Find moments</>}>
            <div className="grid-3">
              <Field label="How many"><input type="number" min={1} max={30} value={count} onChange={(e) => setCount(Number(e.target.value))} /></Field>
              <Field label="Min seconds"><input type="number" min={5} max={170} value={minLen} onChange={(e) => setMinLen(Number(e.target.value))} /></Field>
              <Field label="Max seconds"><input type="number" min={10} max={180} value={maxLen} onChange={(e) => setMaxLen(Number(e.target.value))} /></Field>
            </div>
            <Field label="Looking for something specific? (optional)">
              <input type="text" placeholder="e.g. the part about sleep and caffeine" value={query} onChange={(e) => setQuery(e.target.value)} />
            </Field>
            {templates.length > 0 && (
              <Field label="Style template for new clips">
                <select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                  <option value="">Default style</option>
                  {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </Field>
            )}
            <div className="row">
              <Button variant="primary" icon="sparkle" onClick={findMoments} busy={mo.busy} disabled={!words}>Find moments</Button>
              {!words && <span className="small muted">Needs a transcript first.</span>}
            </div>
            {note && <div className="notice">{note}</div>}
            <JobBar job={mo.job} />
          </Panel>
        </div>
      </div>

      <Panel title={`Clips (${project.clips.length})`} pad={false}
        actions={project.clips.length ? <Button small icon="download" onClick={exportAll} busy={ex.busy}>Export all approved</Button> : null}>
        {ex.job && <div className="panel-body"><JobBar job={ex.job} /></div>}
        {sorted.length === 0 ? <Empty icon="sparkle" title="No clips yet">Find moments automatically, or mark one yourself above.</Empty> : (
          <div className="panel-body grid-auto" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
            {sorted.map((c) => (
              <div key={c.id} className="card clip-card">
                <div className="row top">
                  <ScoreRing score={c.score} />
                  <div className="grow">
                    <h4>{c.title}</h4>
                    <div className="small muted mono">{fmtTime(c.spec.in)} – {fmtTime(c.spec.out)} · {fmtDur(c.spec.out - c.spec.in)}</div>
                  </div>
                  <span className={'pill cap ' + (c.status === 'approved' ? 'good' : c.status === 'posted' ? 'info' : 'muted')}>{c.status}</span>
                </div>
                {c.score && <ScoreTiles score={c.score} />}
                {c.reason && <p className="small muted clamp-2" title={c.reason}>{c.reason}</p>}
                <div className="row" style={{ marginTop: 'auto' }}>
                  <Button variant="primary" small icon="film" onClick={() => go(`studio/${project.id}/${c.id}`)}>Open editor</Button>
                  <span className="spacer" />
                  <Button variant="ghost" small icon="copy" aria-label="Duplicate clip" title="Duplicate" onClick={async () => { await api.post(`/api/projects/${project.id}/clips/${c.id}/duplicate`).catch(toastError); reload(); }} />
                  <Button variant="ghost" small icon="trash" aria-label="Delete clip" title="Delete" onClick={async () => { if (confirm(`Delete "${c.title}"?`)) { await api.del(`/api/projects/${project.id}/clips/${c.id}`).catch(toastError); reload(); } }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
