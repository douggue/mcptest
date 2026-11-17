import { useEffect, useRef, useState } from 'react';

import { go } from '../App';
import { api, upload } from '../api';
import { Button, Empty, Field, JobBar, Modal, Seg, fmtDur, toastError, useJobRunner } from '../ui';
import { ScriptForm, useGenOptions } from './ScriptForm';
import { ProjectSummary } from './types';

export function Projects() {
  const [list, setList] = useState<ProjectSummary[] | null>(null);
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState<'import' | 'script'>('import');
  const { opts } = useGenOptions();
  const [url, setUrl] = useState('');
  const [quality, setQuality] = useState('1080');
  const [uploading, setUploading] = useState<number | null>(null);
  const [over, setOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const { job, run, busy } = useJobRunner();

  const load = () => api.get<ProjectSummary[]>('/api/projects').then(setList).catch(toastError);
  useEffect(() => { load(); }, []);

  async function fromUrl() {
    if (!url.trim()) return;
    setOpen(false);
    try {
      const r = await run<{ project_id: string }>(() => api.post('/api/projects', { url: url.trim(), quality: Number(quality) }));
      go(`studio/${r.project_id}`);
    } catch (e) { toastError(e); }
  }

  async function fromFile(file: File) {
    try {
      const form = new FormData();
      form.append('file', file);
      setUploading(0);
      const { job_id } = await upload<{ job_id: string }>('/api/projects/upload', form, setUploading);
      setUploading(null);
      setOpen(false);
      const r = await run<{ project_id: string }>(async () => ({ job_id }));
      go(`studio/${r.project_id}`);
    } catch (e) { setUploading(null); toastError(e); }
  }

  async function remove(p: ProjectSummary) {
    if (!confirm(`Delete "${p.name}" and its source video? Exported shorts are kept.`)) return;
    await api.del(`/api/projects/${p.id}`).catch(toastError);
    load();
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Shorts studio</h1>
          <p>Bring in a long video, find its best moments, and edit each one into a captioned short.</p>
        </div>
        <Button variant="primary" icon="plus" onClick={() => setOpen(true)} disabled={busy}>New project</Button>
      </div>

      <JobBar job={job} />

      {list === null ? <Empty title="Loading…" /> : list.length === 0 ? (
        <div className="panel">
          <Empty icon="film" title="No projects yet">Import a podcast, interview or any long video to get started.</Empty>
          <div className="row" style={{ justifyContent: 'center', paddingBottom: 40, marginTop: -30 }}>
            <Button variant="primary" icon="plus" onClick={() => setOpen(true)}>New project</Button>
          </div>
        </div>
      ) : (
        <div className="grid-auto" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))' }}>
          {list.map((p) => (
            <div key={p.id} className="card click" onClick={() => go(`studio/${p.id}`)}>
              <div className="thumb-wrap">
                {p.source.poster ? <img className="thumb" src={p.source.poster} alt="" /> : <div className="thumb" />}
                <span className="badge">{fmtDur(p.source.duration)}</span>
              </div>
              <div className="row between" style={{ gap: 6 }}>
                <strong className="ellipsis" title={p.name}>{p.name}</strong>
                <Button className="kebab" variant="ghost" small icon="trash" aria-label="Delete project" title="Delete project" onClick={(e) => { e.stopPropagation(); remove(p); }} />
              </div>
              <div className="row between small muted">
                <span>{p.source.height}p · {p.clips.length} clip{p.clips.length === 1 ? '' : 's'}</span>
                <span className={'pill ' + (p.words ? 'good' : 'muted')}>{p.words ? 'Transcribed' : 'No transcript'}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {open && (
        <Modal title="New project" onClose={() => setOpen(false)}>
          <Seg value={start} onChange={setStart} options={[
            { value: 'import', label: 'Bring in a video' },
            { value: 'script', label: 'Generate from a script', title: 'A narrated video made from generated pictures' },
          ]} />
          {start === 'script' ? (
            opts ? <ScriptForm opts={opts} compact onCancel={() => setOpen(false)} /> : <span className="muted">Loading…</span>
          ) : (
            <>
              <p className="muted" style={{ marginTop: -6 }}>Start from a file on this computer or a link. The video is brought in once and kept in your data folder.</p>
              <div className={'drop' + (over ? ' over' : '')} onClick={() => fileRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
                onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) fromFile(f); }}>
                {uploading !== null ? `Uploading ${Math.round(uploading * 100)}%` : <><strong style={{ color: 'var(--text)' }}>Drop a video here</strong><br />or click to choose a file</>}
              </div>
              <input ref={fileRef} type="file" accept="video/*,.mkv" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) fromFile(f); e.target.value = ''; }} />
              <div className="row" style={{ gap: 12 }}><span className="grow" style={{ height: 1, background: 'var(--line)' }} /><span className="small faint">or</span><span className="grow" style={{ height: 1, background: 'var(--line)' }} /></div>
              <Field label="Video link" hint="Higher quality gives sharper vertical crops, and a bigger download.">
                <input type="url" placeholder="https://www.youtube.com/watch?v=…" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && fromUrl()} autoFocus />
              </Field>
              <div className="row">
                <select value={quality} onChange={(e) => setQuality(e.target.value)} style={{ width: 120 }} aria-label="Quality">
                  <option value="720">720p</option>
                  <option value="1080">1080p</option>
                  <option value="1440">1440p</option>
                  <option value="2160">4K</option>
                </select>
                <span className="spacer" />
                <Button onClick={() => setOpen(false)}>Cancel</Button>
                <Button variant="primary" icon="download" onClick={fromUrl} disabled={!url.trim()}>Import link</Button>
              </div>
            </>
          )}
        </Modal>
      )}
    </div>
  );
}
