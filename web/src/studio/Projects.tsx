import { useEffect, useRef, useState } from 'react';

import { go } from '../App';
import { api, upload } from '../api';
import { Button, Empty, Field, JobBar, Panel, fmtDur, toastError, useJobRunner } from '../ui';
import { ProjectSummary } from './types';

export function Projects() {
  const [list, setList] = useState<ProjectSummary[] | null>(null);
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
      </div>

      <Panel title="New project">
        <div className="row top wrap gap-l">
          <div className="col grow" style={{ minWidth: 280 }}>
            <Field label="Video link" hint="Downloads the whole video once. Higher quality gives sharper vertical crops.">
              <div className="row">
                <input type="url" placeholder="https://www.youtube.com/watch?v=…" value={url} onChange={(e) => setUrl(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && fromUrl()} />
                <select value={quality} onChange={(e) => setQuality(e.target.value)} style={{ width: 110 }} aria-label="Quality">
                  <option value="720">720p</option>
                  <option value="1080">1080p</option>
                  <option value="1440">1440p</option>
                  <option value="2160">4K</option>
                </select>
                <Button variant="primary" icon="download" onClick={fromUrl} disabled={!url.trim() || busy}>Import</Button>
              </div>
            </Field>
          </div>
          <div className="col" style={{ width: 300, maxWidth: '100%' }}>
            <span className="field-label">Or a file from this computer</span>
            <div className={'drop' + (over ? ' over' : '')} onClick={() => fileRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
              onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) fromFile(f); }}>
              {uploading !== null ? `Uploading ${Math.round(uploading * 100)}%` : 'Drop a video here or click to choose'}
            </div>
            <input ref={fileRef} type="file" accept="video/*,.mkv" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) fromFile(f); e.target.value = ''; }} />
          </div>
        </div>
        <JobBar job={job} />
      </Panel>

      <Panel title="Projects" pad={false}>
        {list === null ? <Empty title="Loading…" /> : list.length === 0 ? (
          <Empty title="No projects yet">Import a podcast, interview or any long video to get started.</Empty>
        ) : (
          <div className="panel-body grid-auto">
            {list.map((p) => (
              <div key={p.id} className="card click" onClick={() => go(`studio/${p.id}`)}>
                {p.source.poster ? <img className="thumb" src={p.source.poster} alt="" /> : <div className="thumb" />}
                <strong className="ellipsis" title={p.name}>{p.name}</strong>
                <div className="row between small muted">
                  <span>{fmtDur(p.source.duration)} · {p.source.height}p</span>
                  <span>{p.clips.length} clip{p.clips.length === 1 ? '' : 's'}</span>
                </div>
                <div className="row between">
                  <span className={'pill ' + (p.words ? 'good' : 'muted')}>{p.words ? 'Transcribed' : 'No transcript'}</span>
                  <Button variant="ghost" small icon="trash" aria-label="Delete project" onClick={(e) => { e.stopPropagation(); remove(p); }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
