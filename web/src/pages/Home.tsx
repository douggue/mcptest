import { useEffect, useState } from 'react';

import { Health, go } from '../App';
import { Job, api } from '../api';
import { ExportRow, ProjectSummary } from '../studio/types';
import { Button, Icon, IconName, JobBar, Panel, fmtDur } from '../ui';

const ACTIONS: { icon: IconName; title: string; text: string; to: string; accent?: boolean }[] = [
  { icon: 'scissors', title: 'Clip a video', text: 'Cut a section from a link or a file', to: 'clipper', accent: true },
  { icon: 'sparkle', title: 'Make shorts', text: 'Find the best moments in a long video', to: 'studio' },
  { icon: 'folder', title: 'Open the library', text: 'Exports, music, b-roll and templates', to: 'library' },
  { icon: 'calendar', title: 'Plan posts', text: 'Campaigns, schedule and earnings', to: 'agency' },
];

export default function Home() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [exportsList, setExports] = useState<ExportRow[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [health, setHealth] = useState<Health | null>(null);
  const [folder, setFolder] = useState<boolean | null>(null);

  useEffect(() => {
    api.get<ProjectSummary[]>('/api/projects').then(setProjects).catch(() => {});
    api.get<ExportRow[]>('/api/exports').then(setExports).catch(() => {});
    api.get<Health>('/api/health').then(setHealth).catch(() => {});
    api.get<{ copy_folder: string }>('/api/settings').then((s) => setFolder(!!s.copy_folder)).catch(() => {});
    const poll = () => api.get<Job[]>('/api/jobs').then((all) => setJobs(all.filter((j) => j.status === 'running' || j.status === 'queued'))).catch(() => {});
    poll();
    const id = setInterval(poll, 2000);
    return () => clearInterval(id);
  }, []);

  const checks = health ? [
    { done: health.ffmpeg, title: 'ffmpeg installed', text: health.ffmpeg ? 'Cutting and rendering are ready.' : 'Install ffmpeg and restart; nothing can be cut without it.', required: true },
    { done: health.ai, title: 'AI key added', text: health.ai ? `Using ${health.ai_provider}.` : 'Optional. Adds smarter moment picking, hooks and translation.', to: 'settings' },
    { done: !!folder, title: 'Sync folder set', text: folder ? 'Finished files are copied to your folder.' : 'Optional. Copy every export to Google Drive or Dropbox.', to: 'settings' },
  ] : [];
  const setupOpen = checks.some((c) => !c.done);

  return (
    <div className="page">
      <div className="hero">
        <h1>What will you make today?</h1>
        <p>Clip, caption and publish short videos from this computer.</p>
      </div>

      <div className="actions">
        {ACTIONS.map((a) => (
          <button key={a.to} className="action" onClick={() => go(a.to)}>
            <span className={'icon-tile' + (a.accent ? ' accent' : '')}><Icon name={a.icon} size={18} /></span>
            <div><b>{a.title}</b><span>{a.text}</span></div>
          </button>
        ))}
      </div>

      {jobs.length > 0 && (
        <Panel title="Working on">
          {jobs.map((j) => <JobBar key={j.id} job={j} />)}
        </Panel>
      )}

      {setupOpen && (
        <Panel title="Finish setting up" actions={<span className="small muted">{checks.filter((c) => c.done).length} of {checks.length} done</span>}>
          <div className="checklist">
            {checks.map((c) => (
              <div key={c.title} className="check-row">
                <span className={'check-mark' + (c.done ? ' done' : '')}><Icon name="check" size={13} /></span>
                <div className="grow">
                  <div style={{ fontWeight: 500 }}>{c.title}</div>
                  <div className="small muted">{c.text}</div>
                </div>
                {!c.done && c.to && <Button small onClick={() => go(c.to!)}>Set up</Button>}
              </div>
            ))}
          </div>
        </Panel>
      )}

      <div className="section-head">
        <h2>Recent projects</h2>
        <Button variant="ghost" small onClick={() => go('studio')}>View all <Icon name="arrow" size={13} /></Button>
      </div>
      {projects.length === 0 ? (
        <div className="panel"><div className="empty">
          <span className="empty-icon"><Icon name="film" size={20} /></span>
          <strong>No projects yet</strong>
          <p>Import a podcast, interview or stream and Cutroom will find the moments worth posting.</p>
          <Button variant="primary" icon="plus" onClick={() => go('studio')} style={{ marginTop: 10 }}>New project</Button>
        </div></div>
      ) : (
        <div className="grid-auto" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
          {projects.slice(0, 4).map((p) => (
            <div key={p.id} className="card click" onClick={() => go(`studio/${p.id}`)}>
              <div className="thumb-wrap">
                {p.source.poster ? <img className="thumb" src={p.source.poster} alt="" /> : <div className="thumb" />}
                <span className="badge">{fmtDur(p.source.duration)}</span>
              </div>
              <strong className="ellipsis" title={p.name}>{p.name}</strong>
              <div className="small muted">{p.clips.length} clip{p.clips.length === 1 ? '' : 's'} · {p.words ? 'transcribed' : 'not transcribed'}</div>
            </div>
          ))}
        </div>
      )}

      {exportsList.length > 0 && (
        <>
          <div className="section-head">
            <h2>Latest exports</h2>
            <Button variant="ghost" small onClick={() => go('library')}>View all <Icon name="arrow" size={13} /></Button>
          </div>
          <div className="grid-auto" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
            {exportsList.slice(0, 6).map((r) => (
              <a key={r.id} className="card click" href={r.file} download style={{ color: 'inherit', textDecoration: 'none' }} title="Download">
                <div className="thumb-wrap">
                  {r.cover ? <img className="thumb tall" src={r.cover} alt="" /> : <div className="thumb tall" />}
                  <span className="badge">{fmtDur(r.duration)}</span>
                </div>
                <strong className="ellipsis small" title={r.title}>{r.title}</strong>
              </a>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
